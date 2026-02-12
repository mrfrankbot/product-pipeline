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
 * Sync eBay orders to Shopify.
 * Fetches orders from eBay, deduplicates against local DB + Shopify,
 * creates new Shopify orders for any that don't exist yet.
 */
export const syncOrders = async (
  ebayAccessToken: string,
  shopifyAccessToken: string,
  options: { createdAfter?: string; dryRun?: boolean } = {},
): Promise<SyncResult> => {
  const result: SyncResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

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

  for (const ebayOrder of ebayOrders) {
    try {
      // Check local DB first (fast dedup)
      const existing = await db
        .select()
        .from(orderMappings)
        .where(eq(orderMappings.ebayOrderId, ebayOrder.orderId))
        .get();

      if (existing) {
        result.skipped++;
        continue;
      }

      // Check Shopify (belt + suspenders dedup)
      const shopifyExisting = await findExistingShopifyOrder(
        shopifyAccessToken,
        ebayOrder.orderId,
      );
      if (shopifyExisting) {
        // Save mapping for future fast lookups
        await db
          .insert(orderMappings)
          .values({
            ebayOrderId: ebayOrder.orderId,
            shopifyOrderId: String(shopifyExisting.id),
            shopifyOrderName: shopifyExisting.name,
            status: 'synced',
            syncedAt: new Date(),
            createdAt: new Date(),
          })
          .run();
        result.skipped++;
        continue;
      }

      if (options.dryRun) {
        info(
          `[DRY RUN] Would import: ${ebayOrder.orderId} — $${ebayOrder.pricingSummary.total.value} ${ebayOrder.pricingSummary.total.currency}`,
        );
        result.imported++;
        continue;
      }

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

      // Log sync
      await db
        .insert(syncLog)
        .values({
          direction: 'ebay_to_shopify',
          entityType: 'order',
          entityId: ebayOrder.orderId,
          status: 'success',
          detail: `Created Shopify order ${shopifyOrder.name}`,
          createdAt: new Date(),
        })
        .run();

      info(`Imported: ${ebayOrder.orderId} → Shopify ${shopifyOrder.name}`);
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
