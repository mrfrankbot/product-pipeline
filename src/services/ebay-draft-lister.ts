/**
 * eBay Draft Lister Service
 *
 * Handles creating a live eBay listing from an approved draft.
 * Single-product, explicit-action-only. NO batch, NO auto-publish.
 *
 * Flow:
 *   1. Load draft + Shopify product data
 *   2. Build eBay inventory item (prefer draft content over live Shopify)
 *   3. Ensure eBay location exists
 *   4. Create/replace inventory item on eBay
 *   5. Create offer
 *   6. Publish offer → get listingId
 *   7. Save product_mapping, update draft, log to sync_log
 */

import { getRawDb } from '../db/client.js';
import { getValidEbayToken } from '../ebay/token-manager.js';
import {
  createOrReplaceInventoryItem,
  createOffer,
  publishOffer,
  getLocation,
  createOrUpdateLocation,
  getOffersBySku,
  getBusinessPolicies,
} from '../ebay/inventory.js';
import { getCategoryId, getCategoryName } from '../sync/category-mapper.js';
import { getAspects } from '../sync/aspect-mapper.js';
import { getEbayCondition, resolveMapping, getMapping } from '../sync/attribute-mapping-service.js';
import { cleanTitle, parsePrice } from '../sync/mapper.js';
import { info, warn, error as logError } from '../utils/logger.js';
import { loadShopifyCredentials } from '../config/credentials.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface EbayListingPreview {
  sku: string;
  title: string;
  description: string;
  condition: string;
  conditionDescription?: string;
  categoryId: string;
  categoryName: string;
  price: string;
  currency: string;
  quantity: number;
  imageUrls: string[];
  brand: string;
  mpn: string;
  aspects: Record<string, string[]>;
  policies: {
    fulfillmentPolicyId: string;
    fulfillmentPolicyName: string;
    paymentPolicyId: string;
    paymentPolicyName: string;
    returnPolicyId: string;
    returnPolicyName: string;
  };
  merchantLocationKey: string;
}

export interface ListOnEbayResult {
  success: boolean;
  listingId?: string;
  offerId?: string;
  sku?: string;
  error?: string;
}

/**
 * Optional overrides passed from the eBay listing prep page.
 * Any field here takes precedence over system-generated values.
 */
export interface ListingOverrides {
  title?: string;
  price?: number;
  categoryId?: string;
  condition?: string;
  aspects?: Record<string, string[]>;
  description?: string;
  imageUrls?: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────

const LOCATION_KEY = 'pictureline-slc';

// eBay URL limits: each URL < 500 chars, total < 3975 chars
const EBAY_MAX_SINGLE_URL_LENGTH = 500;
const EBAY_MAX_TOTAL_URL_LENGTH = 3975;

/**
 * Trim image URL list to fit within eBay's URL length limits.
 * eBay requires each URL < 500 chars and total URL length < 3975 chars.
 * If URLs exceed limits, drops images from the end (least important) until within limits.
 */
const shortenImageUrls = (urls: string[]): string[] => {
  // Filter out individual URLs that are too long
  const validUrls: string[] = [];
  for (const url of urls) {
    if (url.length >= EBAY_MAX_SINGLE_URL_LENGTH) {
      warn(`[EbayDraftLister] Dropping image URL (too long: ${url.length} chars): ${url.substring(0, 80)}...`);
    } else {
      validUrls.push(url);
    }
  }

  // Trim to fit within total length limit (URLs joined by commas internally by eBay API)
  const result: string[] = [];
  let totalLength = 0;
  for (const url of validUrls) {
    const separator = result.length > 0 ? 1 : 0; // comma separator between URLs
    if (totalLength + separator + url.length > EBAY_MAX_TOTAL_URL_LENGTH) {
      warn(`[EbayDraftLister] Dropping ${validUrls.length - result.length} image(s) — eBay total URL limit reached (${totalLength} chars used)`);
      break;
    }
    result.push(url);
    totalLength += separator + url.length;
  }

  return result;
};

const mapConditionIdToText = (conditionId: string): string => {
  switch (conditionId) {
    case '1000': return 'NEW';
    case '1500': return 'NEW_OTHER';
    case '3000': return 'USED_EXCELLENT';
    case '7000': return 'FOR_PARTS_OR_NOT_WORKING';
    default: return 'USED_EXCELLENT';
  }
};

const getConditionDescription = async (conditionId: string, shopifyProduct: any): Promise<string | undefined> => {
  try {
    const mapping = await getMapping('listing', 'condition_description');
    const mapped = await resolveMapping(mapping, shopifyProduct);
    if (mapped) return mapped;
  } catch { /* non-fatal */ }

  switch (conditionId) {
    case '3000': return 'Used item in good working condition';
    case '1500': return 'New item with minor cosmetic imperfections';
    default: return undefined;
  }
};

/** Ensure the Pictureline eBay location exists (idempotent). */
const ensureLocation = async (ebayToken: string): Promise<void> => {
  const existing = await getLocation(ebayToken, LOCATION_KEY);
  if (!existing) {
    info(`[EbayDraftLister] Creating eBay inventory location: ${LOCATION_KEY}`);
    await createOrUpdateLocation(ebayToken, LOCATION_KEY, {
      name: 'Pictureline - Salt Lake City',
      location: {
        address: {
          addressLine1: '305 W 700 S',
          city: 'Salt Lake City',
          stateOrProvince: 'UT',
          postalCode: '84101',
          country: 'US',
        },
      },
      merchantLocationStatus: 'ENABLED',
      locationTypes: ['WAREHOUSE'],
    });
  }
};

/** Fetch a Shopify product by ID using the REST API. */
const fetchShopifyProduct = async (
  accessToken: string,
  storeDomain: string,
  productId: string,
): Promise<any | null> => {
  const url = `https://${storeDomain}/admin/api/2024-01/products/${productId}.json`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': accessToken },
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  return data.product ?? null;
};

// ── Core build function ────────────────────────────────────────────────

interface DraftListingData {
  sku: string;
  title: string;
  description: string;
  imageUrls: string[];
  price: number;
  quantity: number;
  barcode?: string;
  vendor: string;
  productType: string;
  weight?: number;
  weightUnit?: string;
  tags: string[];
  shopifyProduct: any; // Full Shopify product for aspect mapping
}

/**
 * Build listing data from draft + Shopify product, preferring draft content.
 */
const buildListingData = (
  draft: any,
  shopifyProduct: any,
): DraftListingData => {
  const variant = shopifyProduct.variants?.[0] ?? {};

  // Prefer draft title/description; fall back to live Shopify
  const title = draft.draft_title || shopifyProduct.title || 'Untitled Product';
  const description = draft.draft_description || shopifyProduct.body_html || '';

  // Prefer draft images; fall back to live Shopify images
  let imageUrls: string[] = [];
  if (draft.draft_images_json) {
    try {
      const parsed: string[] = JSON.parse(draft.draft_images_json);
      imageUrls = parsed.filter((u) => u?.startsWith('http'));
    } catch { /* fall through */ }
  }
  if (imageUrls.length === 0) {
    imageUrls = (shopifyProduct.images ?? [])
      .slice(0, 12)
      .map((img: any) => (img.src || img.url || '').replace(/^http:/, 'https:'))
      .filter((u: string) => u.length > 0);
  }

  const price = parsePrice(variant.price ?? '0');
  const quantity = Math.max(1, variant.inventory_quantity ?? 1); // eBay min qty 1

  return {
    sku: variant.sku || `DRAFT-${draft.id}`,
    title,
    description,
    imageUrls,
    price,
    quantity,
    barcode: variant.barcode,
    vendor: shopifyProduct.vendor || 'Unbranded',
    productType: shopifyProduct.product_type || '',
    weight: variant.weight,
    weightUnit: variant.weight_unit,
    tags: (shopifyProduct.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
    shopifyProduct,
  };
};

// ── Preview (dry run) ──────────────────────────────────────────────────

/**
 * Build a preview of what would be sent to eBay without actually doing it.
 */
export const previewEbayListing = async (
  draftId: number,
): Promise<{ success: boolean; preview?: EbayListingPreview; error?: string }> => {
  try {
    const db = await getRawDb();
    const draft = db.prepare(`SELECT * FROM product_drafts WHERE id = ?`).get(draftId) as any;
    if (!draft) return { success: false, error: 'Draft not found' };

    // Get tokens
    const ebayToken = await getValidEbayToken();
    if (!ebayToken) return { success: false, error: 'eBay not authenticated. Connect eBay in Settings.' };

    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) return { success: false, error: 'Shopify not authenticated.' };

    const creds = await loadShopifyCredentials();
    const shopifyProduct = await fetchShopifyProduct(
      tokenRow.access_token,
      creds.storeDomain,
      draft.shopify_product_id,
    );
    if (!shopifyProduct) return { success: false, error: 'Shopify product not found' };

    const data = buildListingData(draft, shopifyProduct);
    const conditionId = await getEbayCondition(shopifyProduct);
    const conditionText = mapConditionIdToText(conditionId);
    const conditionDesc = await getConditionDescription(conditionId, shopifyProduct);
    const categoryId = getCategoryId(data.productType);
    const aspects = getAspects(categoryId, shopifyProduct, shopifyProduct.variants?.[0] ?? {});
    const policies = await getBusinessPolicies(ebayToken);

    const mpn = (data.sku || '').replace(/-U\d+$/, '') || 'Does Not Apply';
    const upc =
      data.barcode && data.barcode !== '0000000000000' && data.barcode !== '000000000000'
        ? [data.barcode]
        : ['Does Not Apply'];

    const preview: EbayListingPreview = {
      sku: data.sku,
      title: cleanTitle(data.title),
      description: data.description.length > 2000
        ? data.description.slice(0, 1997) + '...'
        : data.description,
      condition: conditionText,
      conditionDescription: conditionDesc,
      categoryId,
      categoryName: getCategoryName(data.productType),
      price: data.price.toFixed(2),
      currency: 'USD',
      quantity: data.quantity,
      imageUrls: data.imageUrls,
      brand: data.vendor,
      mpn,
      aspects,
      policies,
      merchantLocationKey: LOCATION_KEY,
    };

    return { success: true, preview };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`[EbayDraftLister] Preview error for draft ${draftId}: ${msg}`);
    return { success: false, error: msg };
  }
};

// ── Live listing ───────────────────────────────────────────────────────

/**
 * Create a live eBay listing from a draft.
 * Updates the draft with the eBay listing ID and logs to sync_log.
 *
 * SAFETY: Single product only. No auto-trigger. Must be called explicitly.
 *
 * @param overrides  Optional values from the listing prep UI that override system defaults.
 */
export const listDraftOnEbay = async (
  draftId: number,
  overrides: ListingOverrides = {},
): Promise<ListOnEbayResult> => {
  const db = await getRawDb();
  const now = Math.floor(Date.now() / 1000);

  // Load draft
  const draft = db.prepare(`SELECT * FROM product_drafts WHERE id = ?`).get(draftId) as any;
  if (!draft) return { success: false, error: 'Draft not found' };

  // Don't allow re-listing
  if (draft.ebay_listing_id) {
    return {
      success: false,
      error: `Already listed on eBay as listing #${draft.ebay_listing_id}`,
    };
  }

  // Check for existing product_mappings (via shopify_product_id)
  const existingMapping = db.prepare(
    `SELECT ebay_listing_id FROM product_mappings WHERE shopify_product_id = ? AND ebay_listing_id != ''`,
  ).get(draft.shopify_product_id) as any;
  if (existingMapping?.ebay_listing_id) {
    return {
      success: false,
      error: `This product is already mapped to eBay listing #${existingMapping.ebay_listing_id}`,
    };
  }

  // Get tokens
  const ebayToken = await getValidEbayToken();
  if (!ebayToken) return { success: false, error: 'eBay not authenticated. Connect eBay in Settings.' };

  const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
  if (!tokenRow?.access_token) return { success: false, error: 'Shopify not authenticated.' };

  const creds = await loadShopifyCredentials();

  // Load Shopify product
  const shopifyProduct = await fetchShopifyProduct(
    tokenRow.access_token,
    creds.storeDomain,
    draft.shopify_product_id,
  );
  if (!shopifyProduct) return { success: false, error: 'Shopify product not found' };

  const data = buildListingData(draft, shopifyProduct);

  // Apply overrides to image list (overrides take full precedence)
  const rawImageUrls = (overrides.imageUrls && overrides.imageUrls.length > 0)
    ? overrides.imageUrls
    : data.imageUrls;

  // Trim URLs to fit within eBay's length limits (each < 500 chars, total < 3975 chars)
  const effectiveImageUrls = shortenImageUrls(rawImageUrls);

  // eBay requires at least one image
  if (effectiveImageUrls.length === 0) {
    return { success: false, error: 'No images available — eBay requires at least one image. Approve photos or add images to Shopify.' };
  }

  try {
    // Ensure inventory location
    await ensureLocation(ebayToken);

    // Get business policies
    const policies = await getBusinessPolicies(ebayToken);

    // Build eBay data (system defaults, then apply overrides)
    const conditionId = await getEbayCondition(shopifyProduct);
    const systemConditionText = mapConditionIdToText(conditionId);
    const conditionText = overrides.condition ?? systemConditionText;
    const conditionDesc = await getConditionDescription(conditionId, shopifyProduct);
    const systemCategoryId = getCategoryId(data.productType);
    const categoryId = overrides.categoryId ?? systemCategoryId;
    const systemAspects = getAspects(systemCategoryId, shopifyProduct, shopifyProduct.variants?.[0] ?? {});
    const aspects = overrides.aspects ?? systemAspects;

    const effectivePrice = overrides.price ?? data.price;
    const effectiveTitle = overrides.title ? overrides.title : cleanTitle(data.title);
    const effectiveDescription = overrides.description ?? data.description;

    const mpn = data.sku.replace(/-U\d+$/, '') || 'Does Not Apply';
    const effectiveUpc =
      data.barcode && data.barcode !== '0000000000000' && data.barcode !== '000000000000'
        ? [data.barcode]
        : ['Does Not Apply'];

    const finalDescription = effectiveDescription.length > 500000
      ? effectiveDescription.slice(0, 499997) + '...'
      : effectiveDescription;

    // ── Step 1: Create/replace inventory item ──────────────────────
    info(`[EbayDraftLister] Creating inventory item for draft ${draftId} (SKU: ${data.sku})`);
    await createOrReplaceInventoryItem(ebayToken, data.sku, {
      product: {
        title: effectiveTitle,
        description: finalDescription,
        imageUrls: effectiveImageUrls,
        aspects,
        brand: data.vendor,
        mpn,
        upc: effectiveUpc,
      },
      condition: conditionText,
      conditionDescription: conditionDesc,
      availability: {
        shipToLocationAvailability: { quantity: data.quantity },
      },
      packageWeightAndSize: data.weight ? {
        weight: {
          value: data.weight,
          unit: data.weightUnit === 'lb' ? 'POUND' : 'KILOGRAM',
        },
      } : undefined,
    });

    // ── Step 2: Create offer ────────────────────────────────────────
    // Check for existing offer first
    info(`[EbayDraftLister] Creating offer for SKU ${data.sku}`);
    let offerId: string;

    const existingOffers = await getOffersBySku(ebayToken, data.sku);
    if (existingOffers.offers && existingOffers.offers.length > 0) {
      // Reuse existing offer
      offerId = existingOffers.offers[0].offerId!;
      info(`[EbayDraftLister] Reusing existing offer ${offerId}`);
    } else {
      const offerResult = await createOffer(ebayToken, {
        sku: data.sku,
        marketplaceId: 'EBAY_US',
        format: 'FIXED_PRICE',
        availableQuantity: data.quantity,
        pricingSummary: {
          price: { value: effectivePrice.toFixed(2), currency: 'USD' },
        },
        listingPolicies: {
          fulfillmentPolicyId: policies.fulfillmentPolicyId,
          paymentPolicyId: policies.paymentPolicyId,
          returnPolicyId: policies.returnPolicyId,
        },
        merchantLocationKey: LOCATION_KEY,
        categoryId,
        tax: { applyTax: true },
      });
      offerId = offerResult.offerId;
      info(`[EbayDraftLister] Created offer ${offerId}`);
    }

    // ── Step 3: Publish offer ────────────────────────────────────────
    info(`[EbayDraftLister] Publishing offer ${offerId}`);
    const publishResult = await publishOffer(ebayToken, offerId);
    const listingId = publishResult.listingId;
    info(`[EbayDraftLister] ✅ Published! eBay listing ID: ${listingId}`);

    // ── Step 4: Save product mapping ─────────────────────────────────
    const existingMappingRow = db.prepare(
      `SELECT id FROM product_mappings WHERE shopify_product_id = ?`,
    ).get(draft.shopify_product_id) as any;

    if (existingMappingRow) {
      db.prepare(
        `UPDATE product_mappings SET ebay_listing_id = ?, ebay_inventory_item_id = ?, status = 'active', updated_at = ? WHERE shopify_product_id = ?`,
      ).run(listingId, data.sku, now, draft.shopify_product_id);
    } else {
      db.prepare(
        `INSERT INTO product_mappings (shopify_product_id, ebay_listing_id, ebay_inventory_item_id, status, shopify_title, shopify_price, shopify_sku, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      ).run(
        draft.shopify_product_id,
        listingId,
        data.sku,
        effectiveTitle,
        effectivePrice,
        data.sku,
        now,
        now,
      );
    }

    // ── Step 5: Update draft ─────────────────────────────────────────
    db.prepare(
      `UPDATE product_drafts SET ebay_listing_id = ?, ebay_offer_id = ?, status = 'listed', updated_at = ? WHERE id = ?`,
    ).run(listingId, offerId, now, draftId);

    // ── Step 6: Log to sync_log ──────────────────────────────────────
    db.prepare(
      `INSERT INTO sync_log (direction, entity_type, entity_id, status, detail, created_at)
       VALUES ('shopify_to_ebay', 'product', ?, 'success', ?, ?)`,
    ).run(
      draft.shopify_product_id,
      JSON.stringify({
        action: 'list_draft_on_ebay',
        draftId,
        sku: data.sku,
        listingId,
        offerId,
        title: effectiveTitle,
      }),
      now,
    );

    info(`[EbayDraftLister] Draft ${draftId} listed on eBay: listing=${listingId}, offer=${offerId}, sku=${data.sku}`);

    return { success: true, listingId, offerId, sku: data.sku };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`[EbayDraftLister] Error listing draft ${draftId} on eBay: ${msg}`);

    // Log failure to sync_log
    try {
      db.prepare(
        `INSERT INTO sync_log (direction, entity_type, entity_id, status, detail, created_at)
         VALUES ('shopify_to_ebay', 'product', ?, 'failed', ?, ?)`,
      ).run(
        draft.shopify_product_id,
        JSON.stringify({ action: 'list_draft_on_ebay', draftId, error: msg }),
        now,
      );
    } catch { /* non-fatal */ }

    return { success: false, error: msg };
  }
};
