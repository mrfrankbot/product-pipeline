import { fetchAllEbayOrders } from '../ebay/fulfillment.js';
import { createShopifyOrder, findExistingShopifyOrder, } from '../shopify/orders.js';
import { getDb } from '../db/client.js';
import { orderMappings, syncLog } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { info, warn, error as logError } from '../utils/logger.js';
import { assertRateLimit, recordOrderCreation, findDuplicateByTotalDateBuyer, DuplicateOrderError, SAFETY_MODE, } from './order-safety.js';
/**
 * Map an eBay order to Shopify order input.
 */
const mapEbayOrderToShopify = (ebayOrder) => {
    const shipTo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    const nameParts = (shipTo?.fullName || 'eBay Buyer').split(' ');
    const firstName = nameParts[0] || 'eBay';
    const lastName = nameParts.slice(1).join(' ') || 'Buyer';
    const addr = shipTo?.contactAddress;
    return {
        source_name: 'ebay',
        source_identifier: ebayOrder.orderId,
        note: `eBay Order: ${ebayOrder.orderId} (Legacy: ${ebayOrder.legacyOrderId || 'N/A'})\nBuyer: ${ebayOrder.buyer.username}`,
        tags: `eBay,usedcam-0,eBay-${ebayOrder.orderId}`,
        financial_status: ebayOrder.orderPaymentStatus === 'PAID' ? 'paid' : 'pending',
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
        send_receipt: false,
        send_fulfillment_receipt: false,
        suppress_notifications: true,
    };
};
/**
 * Sync eBay orders to Shopify.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ SAFETY CRITICAL: DRY RUN IS THE DEFAULT                                ║
 * ║                                                                         ║
 * ║ You MUST pass confirm=true to create real Shopify orders.               ║
 * ║ Without confirm=true, this function logs what WOULD happen but creates  ║
 * ║ nothing. This is intentional — duplicates cascade into Lightspeed POS.  ║
 * ║                                                                         ║
 * ║ Three layers of duplicate detection:                                    ║
 * ║  1. order_mappings DB (fastest)                                         ║
 * ║  2. Shopify tag search (eBay-{orderId})                                 ║
 * ║  3. Shopify total+date+buyer match                                      ║
 * ║                                                                         ║
 * ║ SAFETY_MODE (default "safe") rate-limits creation to 5/hr, 1/10s.      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export const syncOrders = async (ebayAccessToken, shopifyAccessToken, options = {}) => {
    // ─── Determine real/dry-run mode ──────────────────────────────────────────
    // confirm=true is the authoritative flag. dryRun=false is backward-compat.
    // If neither is set, we default to DRY RUN for safety.
    const isDryRun = options.confirm === true
        ? false
        : options.dryRun === false
            ? false
            : true;
    if (isDryRun) {
        info('[OrderSync] 🔒 DRY RUN MODE — no Shopify orders will be created. Pass confirm=true to create real orders.');
    }
    else {
        info(`[OrderSync] ⚠️  LIVE MODE — will create real Shopify orders (SAFETY_MODE=${SAFETY_MODE})`);
    }
    const result = {
        imported: 0,
        skipped: 0,
        failed: 0,
        dryRun: isDryRun,
        errors: [],
        safetyBlocks: [],
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
        warn(`[OrderSync] SAFETY: Requested date ${createdAfter} exceeds ${MAX_LOOKBACK_DAYS}-day max lookback. ` +
            `Clamping to ${new Date(oldestAllowed).toISOString()}`);
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
            // ── Layer 1: Check local DB (fast dedup) ──────────────────────────────
            const existing = await db
                .select()
                .from(orderMappings)
                .where(eq(orderMappings.ebayOrderId, ebayOrder.orderId))
                .get();
            if (existing) {
                info(`[OrderSync] SKIP (DB match): ${ebayOrder.orderId} → Shopify ${existing.shopifyOrderName}`);
                result.skipped++;
                continue;
            }
            // ── Layer 2: Check Shopify by tag (belt + suspenders) ─────────────────
            const shopifyByTag = await findExistingShopifyOrder(shopifyAccessToken, ebayOrder.orderId);
            if (shopifyByTag) {
                // Save mapping for future fast lookups
                await db
                    .insert(orderMappings)
                    .values({
                    ebayOrderId: ebayOrder.orderId,
                    shopifyOrderId: String(shopifyByTag.id),
                    shopifyOrderName: shopifyByTag.name,
                    status: 'synced',
                    syncedAt: new Date(),
                    createdAt: new Date(),
                })
                    .run();
                info(`[OrderSync] SKIP (Shopify tag match): ${ebayOrder.orderId} → Shopify ${shopifyByTag.name}. Mapping saved.`);
                result.skipped++;
                continue;
            }
            // ── Layer 3: Enhanced duplicate check — total + date + buyer ──────────
            const total = ebayOrder.pricingSummary?.total?.value ?? '0';
            const shopifyByTDB = await findDuplicateByTotalDateBuyer(shopifyAccessToken, {
                total,
                createdAt: ebayOrder.creationDate,
                buyerUsername: ebayOrder.buyer.username,
                ebayOrderId: ebayOrder.orderId,
            });
            if (shopifyByTDB) {
                // This is a definite duplicate — refuse and record it
                const msg = `DUPLICATE BLOCKED: eBay ${ebayOrder.orderId} matches Shopify ${shopifyByTDB.name} ` +
                    `via total+date+buyer check. NOT creating.`;
                warn(`[OrderSync] ${msg}`);
                result.safetyBlocks.push({ ebayOrderId: ebayOrder.orderId, reason: msg });
                result.skipped++;
                // Save mapping so future runs skip via DB (Layer 1)
                await db
                    .insert(orderMappings)
                    .values({
                    ebayOrderId: ebayOrder.orderId,
                    shopifyOrderId: String(shopifyByTDB.id),
                    shopifyOrderName: shopifyByTDB.name,
                    status: 'synced',
                    syncedAt: new Date(),
                    createdAt: new Date(),
                })
                    .onConflictDoNothing()
                    .run();
                continue;
            }
            // ── Dry-run: preview only, no Shopify creation ────────────────────────
            if (isDryRun) {
                info(`[DRY RUN] Would import: ${ebayOrder.orderId} — ` +
                    `$${total} ${ebayOrder.pricingSummary?.total?.currency ?? 'USD'} ` +
                    `(buyer: ${ebayOrder.buyer.username})`);
                result.imported++;
                continue;
            }
            // ── SAFETY_MODE rate limit check ──────────────────────────────────────
            assertRateLimit();
            // ── Create in Shopify ─────────────────────────────────────────────────
            const shopifyInput = mapEbayOrderToShopify(ebayOrder);
            const shopifyOrder = await createShopifyOrder(shopifyAccessToken, shopifyInput);
            // Record creation for rate-limit tracking immediately
            recordOrderCreation();
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
            // Audit log
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
            info(`[OrderSync] Imported: ${ebayOrder.orderId} → Shopify ${shopifyOrder.name}`);
            result.imported++;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Safety blocks (rate limit, duplicate) go to safetyBlocks, not errors
            if (err instanceof DuplicateOrderError) {
                warn(`[OrderSync] Safety block: ${msg}`);
                result.safetyBlocks.push({ ebayOrderId: ebayOrder.orderId, reason: msg });
                result.skipped++;
            }
            else {
                logError(`[OrderSync] Failed to import ${ebayOrder.orderId}: ${msg}`);
                result.failed++;
                result.errors.push({ ebayOrderId: ebayOrder.orderId, error: msg });
                // Audit log failure
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
    }
    return result;
};
