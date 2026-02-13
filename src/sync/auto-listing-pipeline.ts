import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fetchDetailedShopifyProduct } from '../shopify/products.js';
import { saveProductOverride } from './attribute-mapping-service.js';
import { getRawDb } from '../db/client.js';
import { info, warn, error as logError } from '../utils/logger.js';
import { PhotoRoomService } from '../services/photoroom.js';
import {
  createPipelineJob,
  startPipelineJob,
  updatePipelineStep,
} from './pipeline-status.js';

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton)
// ---------------------------------------------------------------------------

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// ---------------------------------------------------------------------------
// processNewProduct — generate description + suggest eBay category via AI
// ---------------------------------------------------------------------------

export async function processNewProduct(
  shopifyProduct: any,
): Promise<{ description: string; ebayCategory: string; ready: boolean }> {
  const openai = getOpenAI();
  const title = shopifyProduct.title || 'Unknown Product';
  const vendor = shopifyProduct.vendor || 'Unknown';

  // Run description and category generation in parallel
  const [descriptionResult, categoryResult] = await Promise.all([
    generateDescription(openai, title, vendor),
    suggestCategory(openai, title, vendor),
  ]);

  const ready = descriptionResult.length > 0 && categoryResult.length > 0;

  return {
    description: descriptionResult,
    ebayCategory: categoryResult,
    ready,
  };
}

const DEFAULT_DESCRIPTION_PROMPT =
  'You are a product description writer for Pictureline, a camera and photography store in Salt Lake City, Utah. Write a compelling, SEO-friendly product description for the following product. Include key features, condition details, and what makes this a good buy. Keep the tone professional but approachable. Format with short paragraphs, no bullet points unless listing specs.';

async function getDescriptionPrompt(): Promise<string> {
  try {
    const db = await getRawDb();
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'description_prompt'`)
      .get() as { value: string } | undefined;
    return row?.value || DEFAULT_DESCRIPTION_PROMPT;
  } catch {
    return DEFAULT_DESCRIPTION_PROMPT;
  }
}

async function generateDescription(
  openai: OpenAI,
  title: string,
  vendor: string,
): Promise<string> {
  try {
    const systemPrompt = await getDescriptionPrompt();

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `Product: ${title}. Brand: ${vendor}. Condition: Used. Keep it under 500 words. Format with HTML paragraphs.`,
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content?.trim() || '';
  } catch (err) {
    logError(`[AutoList] Description generation failed: ${err}`);
    return '';
  }
}

async function suggestCategory(
  openai: OpenAI,
  title: string,
  vendor: string,
): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Given this camera product: ${title} by ${vendor}, what is the most appropriate eBay category ID? Common camera categories: Digital Cameras (31388), Camera Lenses (3323), Camera Flashes (48515), Tripods (30090), Camera Bags (15700), Camcorders (11724), Film Cameras (15230), Camera Drones (179697). Return ONLY the numeric category ID.`,
        },
      ],
      max_tokens: 20,
      temperature: 0,
    });

    const raw = response.choices[0]?.message?.content?.trim() || '';
    // Extract just the numeric ID (strip any extra text)
    const match = raw.match(/\d+/);
    return match ? match[0] : '';
  } catch (err) {
    logError(`[AutoList] Category suggestion failed: ${err}`);
    return '';
  }
}

// ---------------------------------------------------------------------------
// processProductImages — render each image through PhotoRoom template
// ---------------------------------------------------------------------------

/**
 * Process product images via PhotoRoom template rendering.
 *
 * If PHOTOROOM_API_KEY is not set, falls back to returning the original
 * Shopify image URLs (no processing). Processed images are saved to a local
 * temp directory and their file paths are returned.
 */
export async function processProductImages(
  shopifyProduct: any,
): Promise<string[]> {
  const images = shopifyProduct.images || [];
  const imageUrls: string[] = images
    .map((img: any) => (img.url || img.src || '').replace(/^http:/, 'https:'))
    .filter((url: string) => url.length > 0);

  const apiKey = process.env.PHOTOROOM_API_KEY;
  if (!apiKey) {
    info('[AutoList] No PHOTOROOM_API_KEY — skipping image processing, using originals');
    return imageUrls;
  }

  const photoroom = new PhotoRoomService(apiKey);
  const tmpDir = path.join(os.tmpdir(), 'ebay-sync-images', shopifyProduct.id?.toString() || 'unknown');
  fs.mkdirSync(tmpDir, { recursive: true });

  const processedPaths: string[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    try {
      info(`[AutoList] Rendering image ${i + 1}/${imageUrls.length} with PhotoRoom template`);
      const buf = await photoroom.renderWithTemplate(url);
      const filePath = path.join(tmpDir, `image_${i}.png`);
      fs.writeFileSync(filePath, buf);
      processedPaths.push(filePath);
      info(`[AutoList] Saved processed image → ${filePath}`);
    } catch (err) {
      warn(`[AutoList] PhotoRoom render failed for image ${i + 1}, using original URL: ${err}`);
      processedPaths.push(url); // fallback to original
    }
  }

  info(`[AutoList] Image processing complete: ${processedPaths.length}/${imageUrls.length}`);
  return processedPaths;
}

// ---------------------------------------------------------------------------
// autoListProduct — full pipeline: fetch → AI process → save overrides
// ---------------------------------------------------------------------------

export async function autoListProduct(
  shopifyProductId: string,
): Promise<{
  success: boolean;
  jobId?: string;
  description?: string;
  categoryId?: string;
  images?: string[];
  error?: string;
}> {
  const jobId = createPipelineJob(shopifyProductId);

  try {
    info(`[AutoList] Processing product ${shopifyProductId} (job ${jobId})...`);
    startPipelineJob(jobId);

    // ── Step 1: Fetch product ──────────────────────────────────────────
    updatePipelineStep(jobId, 'fetch_product', 'running');

    const db = await getRawDb();
    const tokenRow = db
      .prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`)
      .get() as any;

    if (!tokenRow?.access_token) {
      updatePipelineStep(jobId, 'fetch_product', 'error', 'Shopify token not found');
      return { success: false, jobId, error: 'Shopify token not found' };
    }

    const product = await fetchDetailedShopifyProduct(tokenRow.access_token, shopifyProductId);
    if (!product) {
      updatePipelineStep(jobId, 'fetch_product', 'error', 'Product not found in Shopify');
      return { success: false, jobId, error: `Product ${shopifyProductId} not found in Shopify` };
    }

    updatePipelineStep(jobId, 'fetch_product', 'done', `Fetched: ${product.title || shopifyProductId}`);

    // ── Step 2: Generate description + category ────────────────────────
    updatePipelineStep(jobId, 'generate_description', 'running');

    const result = await processNewProduct(product);

    if (!result.ready) {
      warn(`[AutoList] AI processing incomplete for product ${shopifyProductId}`);
      updatePipelineStep(jobId, 'generate_description', 'error', 'Incomplete AI results');
      return {
        success: false,
        jobId,
        description: result.description || undefined,
        categoryId: result.ebayCategory || undefined,
        error: 'AI processing did not return complete results',
      };
    }

    updatePipelineStep(
      jobId,
      'generate_description',
      'done',
      `Description: ${result.description.length} chars, Category: ${result.ebayCategory}`,
    );

    // ── Step 3: Process images via PhotoRoom ───────────────────────────
    updatePipelineStep(jobId, 'process_images', 'running');

    let processedImages: string[] = [];
    try {
      processedImages = await processProductImages(product);
      updatePipelineStep(
        jobId,
        'process_images',
        'done',
        `${processedImages.length} images processed`,
      );
    } catch (imgErr) {
      warn(`[AutoList] Image processing error (non-fatal): ${imgErr}`);
      updatePipelineStep(jobId, 'process_images', 'error', String(imgErr));
      // Non-fatal — continue without processed images
    }

    // ── Step 4: Save overrides (create_ebay_listing placeholder) ──────
    updatePipelineStep(jobId, 'create_ebay_listing', 'running');

    await saveProductOverride(shopifyProductId, 'listing', 'description', result.description);
    await saveProductOverride(shopifyProductId, 'listing', 'primary_category', result.ebayCategory);

    updatePipelineStep(jobId, 'create_ebay_listing', 'done', 'Overrides saved');

    info(
      `[AutoList] ✅ Product ${shopifyProductId} processed (job ${jobId}) — category=${result.ebayCategory}, description=${result.description.length} chars, images=${processedImages.length}`,
    );

    return {
      success: true,
      jobId,
      description: result.description,
      categoryId: result.ebayCategory,
      images: processedImages,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(`[AutoList] Failed for product ${shopifyProductId} (job ${jobId}): ${errorMsg}`);
    return { success: false, jobId, error: errorMsg };
  }
}
