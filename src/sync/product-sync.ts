import { fetchDetailedShopifyProduct, fetchAllShopifyProducts } from '../shopify/products.js';
import {
  createOrReplaceInventoryItem,
  createOffer,
  publishOffer,
  getInventoryItem,
  type EbayInventoryItem,
  type EbayOffer,
} from '../ebay/inventory.js';
import { getDb } from '../db/client.js';
import { productMappings, syncLog } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { info, warn, error as logError } from '../utils/logger.js';
import { mapCondition, mapCategory } from '../sync/mapping-service.js';
import { cleanTitle, parsePrice } from './mapper.js';

export interface ProductSyncResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ productId: string; error: string }>;
}

/**
 * Default eBay business policies for Used Camera Gear.
 * These should be configurable via settings in a real implementation.
 */
const DEFAULT_POLICIES = {
  fulfillmentPolicyId: '8031490000', // You need to get actual policy IDs from eBay
  paymentPolicyId: '8031491000',
  returnPolicyId: '8031492000',
};

/**
 * Default item location from settings.
 */
const DEFAULT_LOCATION = '305 W 700 S, Salt Lake City, UT 84101';

/**
 * Map a Shopify product to eBay inventory item and offer.
 */
const mapShopifyProductToEbay = async (
  shopifyProduct: any,
  variant: any,
  settings: Record<string, string>,
): Promise<{ inventoryItem: Omit<EbayInventoryItem, 'sku'>; offer: Omit<EbayOffer, 'offerId' | 'sku'> }> => {
  
  const condition = await mapCondition(shopifyProduct.tags);
  const categoryId = await mapCategory(shopifyProduct.productType);
  const price = parsePrice(variant.price);
  const quantity = Math.max(0, variant.inventoryQuantity || 0);
  
  // Clean up description
  let description = shopifyProduct.description || shopifyProduct.title;
  if (description.length > 2000) {
    description = description.slice(0, 1997) + '...';
  }
  
  // Build image URLs (eBay wants HTTPS)
  const imageUrls = shopifyProduct.images
    .slice(0, 12)  // eBay max 12 images
    .map((img: any) => img.url.replace(/^http:/, 'https:'));

  const inventoryItem: Omit<EbayInventoryItem, 'sku'> = {
    product: {
      title: cleanTitle(shopifyProduct.title),
      description,
      imageUrls,
      brand: shopifyProduct.vendor || undefined,
    },
    condition,
    conditionDescription: condition === 'GOOD' ? 'Used but in good working condition' : undefined,
    availability: {
      shipToLocationAvailability: {
        quantity,
      },
    },
    packageWeightAndSize: variant.weight ? {
      weight: {
        value: variant.weight,
        unit: variant.weightUnit === 'lb' ? 'POUND' : 'KILOGRAM',
      },
    } : undefined,
  };

  const offer: Omit<EbayOffer, 'offerId' | 'sku'> = {
    marketplaceId: 'EBAY_US',
    format: 'FIXED_PRICE',
    availableQuantity: quantity,
    pricingSummary: {
      price: {
        value: price.toFixed(2),
        currency: 'USD',
      },
    },
    listingPolicies: {
      fulfillmentPolicyId: DEFAULT_POLICIES.fulfillmentPolicyId,
      paymentPolicyId: DEFAULT_POLICIES.paymentPolicyId,
      returnPolicyId: DEFAULT_POLICIES.returnPolicyId,
    },
    categoryId,
    tax: {
      applyTax: true,
    },
  };

  return { inventoryItem, offer };
};

/**
 * Sync a single Shopify product to eBay.
 * Creates inventory item and offer, publishes the listing.
 */
const syncProductToEbay = async (
  ebayToken: string,
  shopifyToken: string,
  productId: string,
  settings: Record<string, string>,
  options: { dryRun?: boolean } = {},
): Promise<{ success: boolean; error?: string; listingId?: string }> => {
  
  try {
    const db = await getDb();
    
    // Check if already mapped
    const existing = await db
      .select()
      .from(productMappings)
      .where(eq(productMappings.shopifyProductId, productId))
      .get();
    
    if (existing) {
      return { success: false, error: 'Already mapped to eBay' };
    }
    
    // Get detailed product info
    const product = await fetchDetailedShopifyProduct(shopifyToken, productId);
    if (!product) {
      return { success: false, error: 'Product not found' };
    }
    
    if (product.status !== 'active') {
      return { success: false, error: 'Product not active' };
    }
    
    // For now, only handle single variant products
    // Multi-variant support would need more complex eBay variation handling
    if (product.variants.length > 1) {
      return { success: false, error: 'Multi-variant products not supported yet' };
    }
    
    const variant = product.variants[0];
    if (!variant.sku) {
      return { success: false, error: 'Product variant missing SKU' };
    }
    
    if (variant.inventoryQuantity <= 0) {
      return { success: false, error: 'No inventory available' };
    }
    
    if (options.dryRun) {
      info(`[DRY RUN] Would create eBay listing: ${product.title} (SKU: ${variant.sku})`);
      return { success: true };
    }
    
    // Check if inventory item already exists on eBay
    const existingItem = await getInventoryItem(ebayToken, variant.sku);
    
    // Map to eBay format
    const { inventoryItem, offer } = await mapShopifyProductToEbay(product, variant, settings);
    
    // Create/update inventory item
    await createOrReplaceInventoryItem(ebayToken, variant.sku, inventoryItem);
    info(`Created eBay inventory item: ${variant.sku}`);
    
    // Create offer
    const offerResponse = await createOffer(ebayToken, {
      ...offer,
      sku: variant.sku,
    });
    info(`Created eBay offer: ${offerResponse.offerId}`);
    
    // Publish the listing
    const publishResponse = await publishOffer(ebayToken, offerResponse.offerId);
    const listingId = publishResponse.listingId;
    info(`Published eBay listing: ${listingId}`);
    
    // Save mapping
    await db
      .insert(productMappings)
      .values({
        shopifyProductId: productId,
        ebayListingId: listingId,
        ebayInventoryItemId: variant.sku,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    
    // Log sync
    await db
      .insert(syncLog)
      .values({
        direction: 'shopify_to_ebay',
        entityType: 'product',
        entityId: productId,
        status: 'success',
        detail: `Created eBay listing ${listingId} for SKU ${variant.sku}`,
        createdAt: new Date(),
      })
      .run();
    
    return { success: true, listingId };
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(`Failed to sync product ${productId}: ${errorMsg}`);
    
    // Log failure
    const db = await getDb();
    await db
      .insert(syncLog)
      .values({
        direction: 'shopify_to_ebay',
        entityType: 'product',
        entityId: productId,
        status: 'failed',
        detail: errorMsg,
        createdAt: new Date(),
      })
      .run();
    
    return { success: false, error: errorMsg };
  }
};

/**
 * Sync multiple Shopify products to eBay.
 */
export const syncProducts = async (
  ebayToken: string,
  shopifyToken: string,
  productIds: string[],
  settings: Record<string, string> = {},
  options: { dryRun?: boolean } = {},
): Promise<ProductSyncResult> => {
  
  const result: ProductSyncResult = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
  
  info(`Starting product sync for ${productIds.length} products...`);
  
  for (const productId of productIds) {
    result.processed++;
    
    const syncResult = await syncProductToEbay(
      ebayToken,
      shopifyToken,
      productId,
      settings,
      options,
    );
    
    if (syncResult.success) {
      result.created++;
      info(`✅ ${productId} → eBay listing ${syncResult.listingId || 'N/A'}`);
    } else {
      if (syncResult.error?.includes('Already mapped')) {
        result.skipped++;
      } else {
        result.failed++;
        result.errors.push({ productId, error: syncResult.error || 'Unknown error' });
      }
      info(`❌ ${productId}: ${syncResult.error}`);
    }
    
    // Rate limiting: eBay allows 5 requests/sec
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  info(`Product sync complete: ${result.created} created, ${result.skipped} skipped, ${result.failed} failed`);
  return result;
};

/**
 * Auto-sync new Shopify products to eBay based on settings.
 */
export const autoSyncNewProducts = async (
  ebayToken: string,
  shopifyToken: string,
  settings: Record<string, string> = {},
): Promise<ProductSyncResult> => {
  
  if (settings.auto_list !== 'true') {
    info('[AutoSync] Auto-list disabled');
    return {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
  }
  
  const db = await getDb();
  
  // Get all active Shopify products
  const products = await fetchAllShopifyProducts(shopifyToken, { 
    status: 'active',
    limit: 50,  // Start small for testing
  });
  
  // Filter out already mapped products
  const unmappedProducts = [];
  for (const product of products) {
    const existing = await db
      .select()
      .from(productMappings)
      .where(eq(productMappings.shopifyProductId, product.id))
      .get();
    
    if (!existing) {
      unmappedProducts.push(product.id);
    }
  }
  
  if (unmappedProducts.length === 0) {
    info('[AutoSync] No new products to sync');
    return {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
  }
  
  info(`[AutoSync] Found ${unmappedProducts.length} new products to sync`);
  return syncProducts(ebayToken, shopifyToken, unmappedProducts, settings);
};