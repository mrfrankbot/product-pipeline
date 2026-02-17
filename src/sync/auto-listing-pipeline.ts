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
  setPipelineJobTitle,
} from './pipeline-status.js';
import {
  createDraft,
  checkExistingContent,
  getAutoPublishSetting,
  approveDraft,
  getDraftByProduct,
} from '../services/draft-service.js';

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
  const productId = shopifyProduct.id?.toString() || shopifyProduct.admin_graphql_api_id || '';

  // Fetch product notes if available
  let productNotes = '';
  try {
    const db = await getRawDb();
    const row = db
      .prepare(`SELECT product_notes FROM product_mappings WHERE shopify_product_id = ?`)
      .get(productId) as { product_notes: string } | undefined;
    productNotes = row?.product_notes ?? '';
  } catch {
    // Notes are optional — continue without them
  }

  // Look up TIM condition data for the product
  let timConditionText = '';
  try {
    const { findTimItemForProduct, formatConditionForPrompt } = await import('../services/tim-matching.js');
    const variants = shopifyProduct.variants ?? [];
    const skus = variants.map((v: any) => v.sku).filter(Boolean);
    const timData = await findTimItemForProduct(skus);
    if (timData) {
      timConditionText = formatConditionForPrompt(timData);
      info(`[AutoList] Found TIM condition for ${title}: ${timData.condition ?? 'ungraded'}`);
    }
  } catch (err) {
    // TIM lookup is optional — continue without it
    logError(`[AutoList] TIM lookup failed (non-fatal): ${err}`);
  }

  // Run description and category generation in parallel
  const [descriptionResult, categoryResult] = await Promise.all([
    generateDescription(openai, title, vendor, productNotes, timConditionText),
    suggestCategory(openai, title, vendor),
  ]);

  const ready = descriptionResult.length > 0 && categoryResult.length > 0;

  return {
    description: descriptionResult,
    ebayCategory: categoryResult,
    ready,
  };
}

const DEFAULT_DESCRIPTION_PROMPT = `You are a professional copywriter for usedcameragear.com, a trusted source for pre-owned camera equipment. Write high-quality, engaging product descriptions that convert browsers into buyers.

Format your output as follows:

{Product Name} USED — [Catchy 6-8 word tagline highlighting the #1 selling point]

2-3 sentences. Lead with what makes this product special. Reference real-world use cases. Mention original retail price if commonly known.

Key Features:
✔ Exact lens mount or body mount (Sony E, Nikon Z, Canon RF, Fuji X, etc.)
✔ Specific technical specs (focal length, aperture, sensor, AF system)
✔ Compatible camera bodies when relevant
✔ [Additional key features - 4-6 bullet points total]

Condition: {Grade}
Map grades: Mint = virtually new. Like New Minus = near-perfect, faintest marks. Excellent Plus = light use, minor cosmetic marks, pristine optics. Excellent = normal wear, all functions perfect. Good Plus = visible wear, fully functional.
Always confirm: optics clean, no haze/fungus/scratches (unless told otherwise).

Who Is It For?
1-2 sentences targeting a specific photographer type. Be specific, not generic.

What's Included:
List accessories provided. Note missing standard items if known.

Rules:
- Professional, authoritative, enthusiastic but not salesy
- Write like a knowledgeable camera store employee
- Use bold text and ✔ bullets for scannability
- No HTML unless requested. No invented specs.
- No superlatives without substance.
- Output clean, ready-to-publish descriptions without "Title line:" or "Intro:" labels`;

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
  productNotes?: string,
  timConditionText?: string,
): Promise<string> {
  try {
    const systemPrompt = await getDescriptionPrompt();

    let userContent = `Product: ${title}\nBrand: ${vendor}\nCondition: Used — Excellent Plus (assume unless specified otherwise)\nCategory: Auto-detect from product name\nIncluded accessories: Standard items for this product (caps, hood, etc. — assume typical unless specified)`;

    if (timConditionText?.trim()) {
      userContent += `\n\n${timConditionText.trim()}`;
    }

    if (productNotes?.trim()) {
      userContent += `\n\nProduct condition notes (MUST be mentioned in the description): ${productNotes.trim()}`;
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userContent,
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
  const jobId = await createPipelineJob(shopifyProductId);

  const upsertPipelineStatus = async (updates: {
    aiDescriptionGenerated?: boolean;
    aiDescription?: string;
    aiCategoryId?: string;
    imagesProcessed?: boolean;
    imagesProcessedCount?: number;
  }) => {
    const db = await getRawDb();
    const now = Math.floor(Date.now() / 1000);
    const existing = db
      .prepare(`SELECT * FROM product_pipeline_status WHERE shopify_product_id = ?`)
      .get(shopifyProductId) as any | undefined;

    const next = {
      ai_description_generated: updates.aiDescriptionGenerated ?? (existing?.ai_description_generated ?? 0),
      ai_description: updates.aiDescription ?? existing?.ai_description ?? null,
      ai_category_id: updates.aiCategoryId ?? existing?.ai_category_id ?? null,
      images_processed: updates.imagesProcessed ?? (existing?.images_processed ?? 0),
      images_processed_count: updates.imagesProcessedCount ?? existing?.images_processed_count ?? 0,
    };

    if (existing) {
      db.prepare(
        `UPDATE product_pipeline_status
         SET ai_description_generated = ?, ai_description = ?, ai_category_id = ?,
             images_processed = ?, images_processed_count = ?, updated_at = ?
         WHERE shopify_product_id = ?`,
      ).run(
        next.ai_description_generated ? 1 : 0,
        next.ai_description,
        next.ai_category_id,
        next.images_processed ? 1 : 0,
        next.images_processed_count ?? 0,
        now,
        shopifyProductId,
      );
    } else {
      db.prepare(
        `INSERT INTO product_pipeline_status
         (shopify_product_id, ai_description_generated, ai_description, ai_category_id,
          images_processed, images_processed_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        shopifyProductId,
        next.ai_description_generated ? 1 : 0,
        next.ai_description,
        next.ai_category_id,
        next.images_processed ? 1 : 0,
        next.images_processed_count ?? 0,
        now,
        now,
      );
    }
  };

  try {
    info(`[AutoList] Processing product ${shopifyProductId} (job ${jobId})...`);
    await startPipelineJob(jobId);

    // ── Step 1: Fetch product ──────────────────────────────────────────
    await updatePipelineStep(jobId, 'fetch_product', 'running');

    const db = await getRawDb();
    const tokenRow = db
      .prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`)
      .get() as any;

    if (!tokenRow?.access_token) {
      await updatePipelineStep(jobId, 'fetch_product', 'error', 'Shopify token not found');
      return { success: false, jobId, error: 'Shopify token not found' };
    }

    const product = await fetchDetailedShopifyProduct(tokenRow.access_token, shopifyProductId);
    if (!product) {
      await updatePipelineStep(jobId, 'fetch_product', 'error', 'Product not found in Shopify');
      return { success: false, jobId, error: `Product ${shopifyProductId} not found in Shopify` };
    }

    await setPipelineJobTitle(jobId, product.title || shopifyProductId);
    await updatePipelineStep(jobId, 'fetch_product', 'done', `Fetched: ${product.title || shopifyProductId}`);

    // ── Step 2: Generate description + category ────────────────────────
    await updatePipelineStep(jobId, 'generate_description', 'running');

    const result = await processNewProduct(product);

    if (!result.ready) {
      warn(`[AutoList] AI processing incomplete for product ${shopifyProductId}`);
      await updatePipelineStep(jobId, 'generate_description', 'error', 'Incomplete AI results');
      return {
        success: false,
        jobId,
        description: result.description || undefined,
        categoryId: result.ebayCategory || undefined,
        error: 'AI processing did not return complete results',
      };
    }

    await updatePipelineStep(
      jobId,
      'generate_description',
      'done',
      `Description: ${result.description.length} chars, Category: ${result.ebayCategory}`,
    );
    await upsertPipelineStatus({
      aiDescriptionGenerated: true,
      aiDescription: result.description,
      aiCategoryId: result.ebayCategory,
    });

    // ── Step 2b: Apply TIM condition tag to Shopify ──────────────────
    try {
      const { findTimItemForProduct } = await import('../services/tim-matching.js');
      const { applyConditionTag } = await import('../services/tim-tagging.js');
      const skus = (product.variants ?? []).map((v: any) => v.sku).filter(Boolean);
      const timData = await findTimItemForProduct(skus);
      if (timData?.condition) {
        const tagResult = await applyConditionTag(tokenRow.access_token, shopifyProductId, timData.condition);
        if (tagResult.success && !tagResult.skipped) {
          info(`[AutoList] Applied condition tag: ${tagResult.newTag} to product ${shopifyProductId}`);
        }
      }
    } catch (err) {
      // TIM tagging is non-fatal
      logError(`[AutoList] TIM tagging failed (non-fatal): ${err}`);
    }

    // ── Step 3: Process images via PhotoRoom ───────────────────────────
    await updatePipelineStep(jobId, 'process_images', 'running');

    let processedImages: string[] = [];
    try {
      processedImages = await processProductImages(product);
      await updatePipelineStep(
        jobId,
        'process_images',
        'done',
        `${processedImages.length} images processed`,
      );
      await upsertPipelineStatus({
        imagesProcessed: Boolean(process.env.PHOTOROOM_API_KEY),
        imagesProcessedCount: Boolean(process.env.PHOTOROOM_API_KEY) ? processedImages.length : 0,
      });
    } catch (imgErr) {
      warn(`[AutoList] Image processing error (non-fatal): ${imgErr}`);
      await updatePipelineStep(jobId, 'process_images', 'error', String(imgErr));
      // Non-fatal — continue without processed images
    }

    // ── Step 4: Save to draft system (NEVER overwrite live Shopify data) ──
    await updatePipelineStep(jobId, 'create_ebay_listing', 'running');

    // Save overrides for eBay listing use
    await saveProductOverride(shopifyProductId, 'listing', 'description', result.description);
    await saveProductOverride(shopifyProductId, 'listing', 'primary_category', result.ebayCategory);

    // Check what the product currently has on Shopify
    const existingContent = await checkExistingContent(shopifyProductId);

    // Create a draft with processed content + original content for comparison
    const draftId = await createDraft(shopifyProductId, {
      title: product.title || '',
      description: result.description,
      images: processedImages,
      originalTitle: existingContent.title,
      originalDescription: existingContent.description,
      originalImages: existingContent.images,
    });

    // Auto-publish logic:
    // If product has NO existing content AND auto-publish is enabled → publish directly
    // If product HAS existing content → always save as draft, never overwrite
    const productType = product.productType || 'default';
    const autoPublishEnabled = await getAutoPublishSetting(productType);
    const hasExistingContent = existingContent.hasPhotos || existingContent.hasDescription;

    if (!hasExistingContent && autoPublishEnabled) {
      info(`[AutoList] Product ${shopifyProductId} has no existing content and auto-publish is ON — publishing directly`);
      const approveResult = await approveDraft(draftId, { photos: true, description: true });
      if (approveResult.success) {
        await updatePipelineStep(jobId, 'create_ebay_listing', 'done', 'Auto-published (no existing content)');
      } else {
        await updatePipelineStep(jobId, 'create_ebay_listing', 'done', `Draft created (#${draftId}) — auto-publish failed: ${approveResult.error}`);
      }
    } else {
      const reason = hasExistingContent
        ? 'product has existing content — requires manual review'
        : 'auto-publish disabled for this product type';
      await updatePipelineStep(jobId, 'create_ebay_listing', 'done', `Draft created (#${draftId}) — ${reason}`);
      info(`[AutoList] Draft #${draftId} saved for review — ${reason}`);
    }

    info(
      `[AutoList] ✅ Product ${shopifyProductId} processed (job ${jobId}) — category=${result.ebayCategory}, description=${result.description.length} chars, images=${processedImages.length}, draft=#${draftId}`,
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
