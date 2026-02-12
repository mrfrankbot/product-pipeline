import OpenAI from 'openai';
import { fetchDetailedShopifyProduct } from '../shopify/products.js';
import { saveProductOverride } from './attribute-mapping-service.js';
import { getRawDb } from '../db/client.js';
import { info, warn, error as logError } from '../utils/logger.js';

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

async function generateDescription(
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
          content: `Write a professional eBay listing description for a used camera product. Product: ${title}. Brand: ${vendor}. Condition: Used. Include key features, what's included, and a brief note about condition. Keep it under 500 words. Format with HTML paragraphs. Professional but friendly tone. The seller is Pictureline, a camera store in Salt Lake City, UT.`,
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
// processProductImages — return Shopify image URLs (PhotoRoom later)
// ---------------------------------------------------------------------------

// TODO: Integrate PhotoRoom API to automatically remove backgrounds,
// enhance product images, and create professional white-background photos
// before sending to eBay. PhotoRoom API: https://www.photoroom.com/api
export async function processProductImages(
  shopifyProduct: any,
): Promise<string[]> {
  const images = shopifyProduct.images || [];
  return images
    .map((img: any) => (img.url || img.src || '').replace(/^http:/, 'https:'))
    .filter((url: string) => url.length > 0);
}

// ---------------------------------------------------------------------------
// autoListProduct — full pipeline: fetch → AI process → save overrides
// ---------------------------------------------------------------------------

export async function autoListProduct(
  shopifyProductId: string,
): Promise<{ success: boolean; description?: string; categoryId?: string; error?: string }> {
  try {
    info(`[AutoList] Processing product ${shopifyProductId}...`);

    // Get Shopify token from DB
    const db = await getRawDb();
    const tokenRow = db
      .prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`)
      .get() as any;

    if (!tokenRow?.access_token) {
      return { success: false, error: 'Shopify token not found' };
    }

    // Fetch product from Shopify
    const product = await fetchDetailedShopifyProduct(tokenRow.access_token, shopifyProductId);
    if (!product) {
      return { success: false, error: `Product ${shopifyProductId} not found in Shopify` };
    }

    // Run AI pipeline
    const result = await processNewProduct(product);

    if (!result.ready) {
      warn(`[AutoList] AI processing incomplete for product ${shopifyProductId}`);
      return {
        success: false,
        description: result.description || undefined,
        categoryId: result.ebayCategory || undefined,
        error: 'AI processing did not return complete results',
      };
    }

    // Save description as product override
    await saveProductOverride(
      shopifyProductId,
      'listing',
      'description',
      result.description,
    );

    // Save category as product override
    await saveProductOverride(
      shopifyProductId,
      'listing',
      'primary_category',
      result.ebayCategory,
    );

    info(
      `[AutoList] ✅ Product ${shopifyProductId} processed — category=${result.ebayCategory}, description=${result.description.length} chars`,
    );

    return {
      success: true,
      description: result.description,
      categoryId: result.ebayCategory,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(`[AutoList] Failed for product ${shopifyProductId}: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}
