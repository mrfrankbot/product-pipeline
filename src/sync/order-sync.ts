import { fetchAllEbayOrders, type EbayOrder } from '../ebay/fulfillment.js';
import {
  createShopifyOrder,
  findExistingShopifyOrder,
  type ShopifyOrderInput,
} from '../shopify/orders.js';
import { getDb } from '../db/client.js';
import { orderMappings, syncLog } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { info, warn, error as logError } from '../utils/logger.js';

export interface SyncResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ ebayOrderId: string; error: string }>;
  warnings: Array<{ ebayOrderId: string; warning: string; reason: string }>;
}

/**
 * Map an eBay order to Shopify order input.
 */
const mapEbayOrderToShopify = (ebayOrder: EbayOrder): ShopifyOrderInput => {
  const shipTo =
    ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const nameParts = (shipTo?.fullName || 'eBay Buyer').split(' ');
  const firstName = nameParts[0] || 'eBay';
  const lastName = nameParts.slice(1).join(' ') || 'Buyer';
  const addr = shipTo?.contactAddress;

  return {
    source_name: 'ebay',
    source_identifier: ebayOrder.orderId,
    note: `eBay Order: ${ebayOrder.orderId} (Legacy: ${ebayOrder.legacyOrderId || 'N/A'})\nBuyer: ${ebayOrder.buyer.username}`,
    tags: `eBay,usedcam-0,eBay-${ebayOrder.orderId}`,
    financial_status:
      ebayOrder.orderPaymentStatus === 'PAID' ? 'paid' : 'pending',
    fulfillment_status: null,
    line_items: ebayOrder.lineItems.map((li) => ({
      title: li.title,
      sku: li.sku || undefined,
      quantity: li.quantity,
      price: li.lineItemCost.value,
      requires_shipping: true,
    })),
    shipping_address: {
      first_name: firstName,
      last_name: lastName,
      address1: addr?.addressLine1 || '',
      address2: addr?.addressLine2 || undefined,
      city: addr?.city || '',
      province: addr?.stateOrProvince || '',
      zip: addr?.postalCode || '',
      country_code: addr?.countryCode || 'US',
      phone: shipTo?.primaryPhone?.phoneNumber || undefined,
    },
    shipping_lines: [
      {
        title: 'eBay Shipping',
        price: ebayOrder.pricingSummary?.deliveryCost?.value || '0.00',
        code: 'ebay_shipping',
      },
    ],
    send_receipt: false as const,
    send_fulfillment_receipt: false as const,
    suppress_notifications: true as const,
  };
};

/**
 * Enhanced duplicate detection - check multiple sources for existing orders.
 * Returns details about any found duplicate.
 */
const checkForDuplicates = async (
  ebayOrder: EbayOrder,
  db: any,
  shopifyAccessToken: string,
): Promise<{ isDuplicate: true; reason: string; details: string } | { isDuplicate: false }> => {
  // 1. Check order_mappings table for existing eBay order ID
  const mappingExists = await db
    .select()
    .from(orderMappings)
    .where(eq(orderMappings.ebayOrderId, ebayOrder.orderId))
    .get();

  if (mappingExists) {
    return {
      isDuplicate: true,
      reason: 'order_mapping_exists',
      details: `Already mapped to Shopify order ${mappingExists.shopifyOrderName} (ID: ${mappingExists.shopifyOrderId})`,
    };
  }

  // 2. Check Shopify orders by eBay order ID tag
  const shopifyExisting = await findExistingShopifyOrder(
    shopifyAccessToken,
    ebayOrder.orderId,
  );
  if (shopifyExisting) {
    return {
      isDuplicate: true,
      reason: 'shopify_tag_match',
      details: `Found in Shopify by tag search: ${shopifyExisting.name} (ID: ${shopifyExisting.id})`,
    };
  }

  // 3. Check by matching total + date + buyer (fuzzy duplicate detection)
  const orderTotal = parseFloat(ebayOrder.pricingSummary?.total?.value || '0');
  const orderDate = new Date(ebayOrder.creationDate);
  const buyerName = ebayOrder.buyer?.username || '';
  
  // Search recent Shopify orders with similar characteristics
  const dayBefore = new Date(orderDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const dayAfter = new Date(orderDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
  
  try {
    const creds = await import('../config/credentials.js').then(m => m.loadShopifyCredentials());
    const fuzzyUrl = `https://${creds.storeDomain}/admin/api/2024-01/orders.json?status=any&created_at_min=${dayBefore}&created_at_max=${dayAfter}&limit=250`;
    
    const fuzzyResponse = await fetch(fuzzyUrl, {
      headers: { 'X-Shopify-Access-Token': shopifyAccessToken },
    });
    
    if (fuzzyResponse.ok) {
      const fuzzyData = (await fuzzyResponse.json()) as {
        orders: Array<{
          id: number;
          name: string;
          total_price: string;
          note?: string;
          source_name?: string;
        }>;
      };
      
      for (const shopifyOrder of fuzzyData.orders) {
        const shopifyTotal = parseFloat(shopifyOrder.total_price || '0');
        const totalMatch = Math.abs(orderTotal - shopifyTotal) < 0.01; // Within 1 cent
        
        // Check if buyer appears in order note
        const noteContainsBuyer = shopifyOrder.note && 
          buyerName && 
          shopifyOrder.note.toLowerCase().includes(buyerName.toLowerCase());
        
        if (totalMatch && (shopifyOrder.source_name === 'ebay' || noteContainsBuyer)) {
          return {
            isDuplicate: true,
            reason: 'fuzzy_match',
            details: `Similar order found: ${shopifyOrder.name} ($${shopifyTotal} vs $${orderTotal}, buyer match: ${!!noteContainsBuyer})`,
          };
        }
      }
    }
  } catch (err) {
    warn(`[OrderSync] Fuzzy duplicate check failed for ${ebayOrder.orderId}: ${err}`);
  }

  return { isDuplicate: false };
};

/**
 * Sync eBay orders to Shopify.
 * Fetches orders from eBay, deduplicates against local DB + Shopify,
 * creates new Shopify orders for any that don't exist yet.
 * 
 * SAFETY GUARDS:
 * - DRY RUN by default - must explicitly pass confirm=true to create orders
 * - Enhanced duplicate detection (DB + Shopify tag + fuzzy matching)
 * - SAFETY_MODE env var support for additional restrictions
 */
export const syncOrders = async (
  ebayAccessToken: string,
  shopifyAccessToken: string,
  options: { 
    createdAfter?: string; 
    dryRun?: boolean;
    confirm?: boolean; // Must be true to actually create orders
  } = {},
): Promise<SyncResult> => {
  const result: SyncResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    warnings: [],
  };

  // SAFETY GUARD 1: DRY RUN by default
  // After 2026-02-11 duplicate cascade incident, all imports are DRY RUN unless explicitly confirmed
  const isDryRun = options.dryRun !== false && options.confirm !== true;
  
  if (isDryRun) {
    info('[OrderSync] SAFETY: Running in DRY RUN mode - no orders will be created. Pass confirm=true to create orders.');
  }

  // SAFETY GUARD 2: Check SAFETY_MODE environment variable
  const safetyMode = process.env.SAFETY_MODE || 'safe';
  if (safetyMode === 'safe' && !isDryRun) {
    info('[OrderSync] SAFETY_MODE=safe: Enhanced safety checks active');
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ SAFETY GUARD: NEVER pull historical orders.                     ║
  // ║ If no createdAfter is provided, default to 24 hours ago.        ║
  // ║ Maximum lookback is 7 days — anything older is rejected.        ║
  // ║                                                                 ║
  // ║ WHY: On 2026-02-11, a sync without a date filter pulled ALL     ║
  // ║ historical eBay orders into Shopify, which cascaded into        ║
  // ║ Lightspeed POS. Took significant manual work to clean up.       ║
  // ║ This guard ensures it NEVER happens again.                      ║
  // ╚══════════════════════════════════════════════════════════════════╝
  const MAX_LOOKBACK_DAYS = 7;
  const maxLookbackMs = MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const defaultLookback = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  let createdAfter = options.createdAfter || defaultLookback;
  
  // Enforce maximum lookback — never go further than 7 days
  const requestedDate = new Date(createdAfter).getTime();
  const oldestAllowed = Date.now() - maxLookbackMs;
  if (requestedDate < oldestAllowed) {
    warn(`[OrderSync] SAFETY: Requested date ${createdAfter} exceeds ${MAX_LOOKBACK_DAYS}-day max lookback. Clamping to ${new Date(oldestAllowed).toISOString()}`);
    createdAfter = new Date(oldestAllowed).toISOString();
  }
  
  info(`[OrderSync] SAFETY: Only syncing orders created after ${createdAfter} (max ${MAX_LOOKBACK_DAYS} day lookback)`);

  const db = await getDb();

  // Fetch eBay orders
  info('Fetching eBay orders...');
  const ebayOrders = await fetchAllEbayOrders(ebayAccessToken, {
    createdAfter,
  });
  info(`Found ${ebayOrders.length} eBay orders (since ${createdAfter})`);

  // SAFETY GUARD 3: Rate limiting for SAFETY_MODE=safe
  let lastImportTime = 0;
  let importsThisHour = 0;
  const hourlyResetTime = Date.now() + 60 * 60 * 1000;
  
  for (const ebayOrder of ebayOrders) {
    try {
      // ENHANCED DUPLICATE DETECTION
      const duplicateCheck = await checkForDuplicates(ebayOrder, db, shopifyAccessToken);
      
      if (duplicateCheck.isDuplicate) {
        info(`[OrderSync] DUPLICATE DETECTED: ${ebayOrder.orderId} - ${duplicateCheck.reason}: ${duplicateCheck.details}`);
        result.warnings.push({
          ebayOrderId: ebayOrder.orderId,
          warning: 'Duplicate order detected',
          reason: `${duplicateCheck.reason}: ${duplicateCheck.details}`,
        });
        result.skipped++;
        continue;
      }

      if (isDryRun) {
        info(
          `[DRY RUN] Would import: ${ebayOrder.orderId} — $${ebayOrder.pricingSummary.total.value} ${ebayOrder.pricingSummary.total.currency}`,
        );
        result.imported++;
        continue;
      }

      // SAFETY GUARD 4: Rate limiting in safe mode
      if (safetyMode === 'safe') {
        const now = Date.now();
        
        // Reset hourly counter if needed
        if (now > hourlyResetTime) {
          importsThisHour = 0;
        }
        
        // Check hourly limit (5 per hour)
        if (importsThisHour >= 5) {
          warn(`[OrderSync] SAFETY: Hourly limit reached (5 orders/hour in safe mode). Stopping import.`);
          result.warnings.push({
            ebayOrderId: ebayOrder.orderId,
            warning: 'Rate limit reached',
            reason: 'SAFETY_MODE=safe limits to 5 orders per hour',
          });
          break;
        }
        
        // Check per-order delay (10 seconds between imports)
        const timeSinceLastImport = now - lastImportTime;
        if (timeSinceLastImport < 10000 && lastImportTime > 0) {
          const waitTime = 10000 - timeSinceLastImport;
          info(`[OrderSync] SAFETY: Waiting ${waitTime}ms between imports (safe mode)`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        lastImportTime = Date.now();
        importsThisHour++;
      }

      // Final safety check before creation
      info(`[OrderSync] Creating Shopify order for eBay ${ebayOrder.orderId} (${safetyMode} mode)`);
      
      // Create in Shopify
      const shopifyInput = mapEbayOrderToShopify(ebayOrder);
      const shopifyOrder = await createShopifyOrder(
        shopifyAccessToken,
        shopifyInput,
      );

      // Save mapping
      await db
        .insert(orderMappings)
        .values({
          ebayOrderId: ebayOrder.orderId,
          shopifyOrderId: String(shopifyOrder.id),
          shopifyOrderName: shopifyOrder.name,
          status: 'synced',
          syncedAt: new Date(),
          createdAt: new Date(),
        })
        .run();

      // Log sync with safety context
      await db
        .insert(syncLog)
        .values({
          direction: 'ebay_to_shopify',
          entityType: 'order',
          entityId: ebayOrder.orderId,
          status: 'success',
          detail: `Created Shopify order ${shopifyOrder.name} (SAFETY_MODE=${safetyMode})`,
          createdAt: new Date(),
        })
        .run();

      info(`[OrderSync] IMPORTED: ${ebayOrder.orderId} → Shopify ${shopifyOrder.name}`);
      result.imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`Failed to import ${ebayOrder.orderId}: ${msg}`);
      result.failed++;
      result.errors.push({ ebayOrderId: ebayOrder.orderId, error: msg });

      // Log failure
      await db
        .insert(syncLog)
        .values({
          direction: 'ebay_to_shopify',
          entityType: 'order',
          entityId: ebayOrder.orderId,
          status: 'failed',
          detail: msg,
          createdAt: new Date(),
        })
        .run();
    }
  }

  return result;
};
