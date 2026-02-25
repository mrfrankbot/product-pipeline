import { Router } from 'express';
import crypto from 'node:crypto';
import { getRawDb } from '../../db/client.js';
import { info, warn, error as logError } from '../../utils/logger.js';
import { loadShopifyCredentials } from '../../config/credentials.js';
const router = Router();
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function verifyShopifyWebhook(req) {
    try {
        const creds = await loadShopifyCredentials();
        const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
        if (!hmacHeader)
            return false;
        const rawBody = req.rawBody;
        if (!rawBody) {
            warn('[Shopify Webhook] No raw body for HMAC verification');
            return false; // Fail verification if no body
        }
        const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
        const hash = crypto
            .createHmac('sha256', creds.clientSecret)
            .update(bodyStr, 'utf8')
            .digest('base64');
        return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
    }
    catch {
        return false;
    }
}
/** Get tokens for both platforms from the auth_tokens table. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTokens(db) {
    const ebayRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'ebay'`).get();
    const shopifyRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get();
    return {
        ebayToken: ebayRow?.access_token ?? null,
        shopifyToken: shopifyRow?.access_token ?? null,
    };
}
/** Mark a notification_log entry as processed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function markProcessed(db, topic, source = 'shopify') {
    db.prepare(`UPDATE notification_log SET processed_at = unixepoch()
     WHERE id = (SELECT id FROM notification_log WHERE source = ? AND topic = ? ORDER BY id DESC LIMIT 1)`).run(source, topic);
}
/** Mark a notification_log entry as errored with detail. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function markError(db, topic, _errorMsg, source = 'shopify') {
    db.prepare(`UPDATE notification_log SET processed_at = unixepoch()
     WHERE id = (SELECT id FROM notification_log WHERE source = ? AND topic = ? ORDER BY id DESC LIMIT 1)`).run(source, topic);
}
/** Resolve a Shopify inventory_item_id to its SKU via REST API. */
async function resolveInventoryItemSku(shopifyToken, inventoryItemId) {
    const creds = await loadShopifyCredentials();
    const url = `https://${creds.storeDomain}/admin/api/2024-01/inventory_items/${inventoryItemId}.json`;
    const response = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': shopifyToken },
    });
    if (!response.ok) {
        warn(`[Webhook] Failed to resolve inventory item ${inventoryItemId}: ${response.status}`);
        return null;
    }
    const data = (await response.json());
    return data.inventory_item?.sku || null;
}
// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
router.post('/webhooks/shopify/:topic', async (req, res) => {
    const rawTopic = req.params.topic || req.get('X-Shopify-Topic') || 'unknown';
    const topic = Array.isArray(rawTopic) ? rawTopic[0] : rawTopic;
    res.status(200).send('OK');
    const isValid = await verifyShopifyWebhook(req);
    if (!isValid) {
        warn(`[Shopify Webhook] HMAC verification failed: ${topic}`);
        return; // Stop processing if signature is invalid
    }
    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    info(`[Shopify Webhook] Received: ${topic}`);
    try {
        const db = await getRawDb();
        db.prepare(`INSERT INTO notification_log (source, topic, message) VALUES (?, ?, ?)`).run('shopify', topic, payload.substring(0, 10000));
    }
    catch (err) {
        logError(`[Shopify Webhook] Log error: ${err}`);
    }
    try {
        await handleShopifyWebhook(topic, req.body);
    }
    catch (err) {
        logError(`[Shopify Webhook] Handler error for ${topic}: ${err}`);
        try {
            const db = await getRawDb();
            markError(db, topic, err instanceof Error ? err.message : String(err));
        }
        catch { /* best-effort */ }
    }
});
// ---------------------------------------------------------------------------
// Router → handler dispatch
// ---------------------------------------------------------------------------
async function handleShopifyWebhook(topic, body) {
    try {
        switch (topic) {
            case 'products/update':
            case 'products-update':
                await handleProductUpdate(body, topic);
                break;
            case 'products/create':
            case 'products-create':
                await handleProductCreate(body, topic);
                break;
            case 'products/delete':
            case 'products-delete':
                await handleProductDelete(body, topic);
                break;
            case 'orders/fulfilled':
            case 'orders-fulfilled':
                await handleOrderFulfilled(body);
                break;
            case 'inventory_levels/update':
            case 'inventory_levels-update':
                await handleInventoryUpdate(body, topic);
                break;
            default:
                warn(`[Shopify Webhook] Unhandled: ${topic}`);
        }
    }
    catch (err) {
        logError(`[Shopify Webhook] Handler error for ${topic}: ${err}`);
        throw err; // re-throw so the outer catch can mark the log entry
    }
}
// ---------------------------------------------------------------------------
// 1. products/update — update eBay listing details & price
// ---------------------------------------------------------------------------
async function handleProductUpdate(body, topic) {
    const productId = String(body?.id);
    info(`[Shopify Webhook] Product updated: ${body?.title} (${productId})`);
    const db = await getRawDb();
    // Check if this product is mapped to eBay
    const mapping = db.prepare(`SELECT * FROM product_mappings WHERE shopify_product_id = ? AND status = 'active'`).get(productId);
    if (!mapping) {
        info(`[Webhook] Product ${productId} not mapped to eBay — skipping update`);
        markProcessed(db, topic);
        return;
    }
    const { ebayToken, shopifyToken } = await getTokens(db);
    if (!ebayToken || !shopifyToken) {
        warn(`[Webhook] Missing tokens (ebay=${!!ebayToken}, shopify=${!!shopifyToken})`);
        markError(db, topic, 'Missing platform tokens');
        return;
    }
    try {
        const { updateProductOnEbay } = await import('../../sync/product-sync.js');
        const result = await updateProductOnEbay(ebayToken, shopifyToken, productId);
        if (result.success) {
            info(`[Webhook] eBay listing updated for product ${productId}: ${result.updated.join(', ')}`);
            markProcessed(db, topic);
        }
        else {
            warn(`[Webhook] eBay update failed for product ${productId}: ${result.error}`);
            markError(db, topic, result.error || 'Unknown update error');
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`[Webhook] products/update error for ${productId}: ${msg}`);
        markError(db, topic, msg);
    }
}
// ---------------------------------------------------------------------------
// 2. products/delete — withdraw eBay offer, mark mapping ended
// ---------------------------------------------------------------------------
async function handleProductDelete(body, topic) {
    const productId = String(body?.id);
    info(`[Shopify Webhook] Product deleted: ${productId}`);
    const db = await getRawDb();
    const mapping = db.prepare(`SELECT * FROM product_mappings WHERE shopify_product_id = ?`).get(productId);
    if (!mapping) {
        info(`[Webhook] Product ${productId} not mapped to eBay — nothing to end`);
        markProcessed(db, topic);
        return;
    }
    if (mapping.status === 'ended') {
        info(`[Webhook] Mapping for ${productId} already ended`);
        markProcessed(db, topic);
        return;
    }
    const { ebayToken } = await getTokens(db);
    if (!ebayToken) {
        warn(`[Webhook] No eBay token — cannot withdraw offer`);
        markError(db, topic, 'Missing eBay token');
        return;
    }
    try {
        const { endEbayListing } = await import('../../sync/product-sync.js');
        const result = await endEbayListing(ebayToken, productId);
        if (result.success) {
            info(`[Webhook] eBay listing ended for deleted product ${productId}`);
            markProcessed(db, topic);
        }
        else {
            warn(`[Webhook] Failed to end eBay listing for ${productId}: ${result.error}`);
            markError(db, topic, result.error || 'Unknown end-listing error');
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`[Webhook] products/delete error for ${productId}: ${msg}`);
        markError(db, topic, msg);
    }
}
// ---------------------------------------------------------------------------
// 3. inventory_levels/update — resolve SKU, sync qty/delist/relist
// ---------------------------------------------------------------------------
async function handleInventoryUpdate(body, topic) {
    const inventoryItemId = body?.inventory_item_id;
    const available = body?.available;
    info(`[Shopify Webhook] Inventory updated: item ${inventoryItemId}, available: ${available}`);
    const db = await getRawDb();
    // Resolve inventory_item_id → SKU via Shopify REST API
    const { ebayToken, shopifyToken } = await getTokens(db);
    if (!ebayToken || !shopifyToken) {
        warn(`[Webhook] Missing tokens for inventory sync`);
        markError(db, topic, 'Missing platform tokens');
        return;
    }
    try {
        const sku = await resolveInventoryItemSku(shopifyToken, inventoryItemId);
        if (!sku) {
            info(`[Webhook] Could not resolve SKU for inventory item ${inventoryItemId} — skipping`);
            markProcessed(db, topic);
            return;
        }
        info(`[Webhook] Resolved inventory item ${inventoryItemId} → SKU ${sku}`);
        // Check if this SKU is mapped to eBay
        const mapping = db.prepare(`SELECT * FROM product_mappings WHERE ebay_inventory_item_id = ?`).get(sku);
        if (!mapping) {
            info(`[Webhook] SKU ${sku} not mapped to eBay — skipping`);
            markProcessed(db, topic);
            return;
        }
        const quantity = Math.max(0, available ?? 0);
        // Use the full inventory sync logic which handles 0→withdraw, 0→>0 relist, and normal updates
        const { updateEbayInventory } = await import('../../sync/inventory-sync.js');
        const result = await updateEbayInventory(ebayToken, sku, quantity);
        if (result.success) {
            info(`[Webhook] eBay inventory updated for ${sku}: qty=${quantity}, action=${result.action}`);
            markProcessed(db, topic);
        }
        else {
            // "unchanged" is not really an error — still mark processed
            if (result.error?.includes('unchanged')) {
                info(`[Webhook] eBay inventory for ${sku} unchanged at ${quantity}`);
                markProcessed(db, topic);
            }
            else {
                warn(`[Webhook] eBay inventory update failed for ${sku}: ${result.error}`);
                markError(db, topic, result.error || 'Unknown inventory error');
            }
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`[Webhook] inventory_levels/update error: ${msg}`);
        markError(db, topic, msg);
    }
}
// ---------------------------------------------------------------------------
// 4. products/create — log only (auto-list disabled by default)
// ---------------------------------------------------------------------------
async function handleProductCreate(body, topic) {
    const productId = String(body?.id);
    info(`[Shopify Webhook] New product: ${body?.title} (${productId})`);
    const db = await getRawDb();
    const settings = db.prepare(`SELECT value FROM settings WHERE key = 'auto_list'`).get();
    if (settings?.value === 'true') {
        info(`[Webhook] Auto-list enabled — creating eBay listing for product ${productId}`);
        const { ebayToken, shopifyToken } = await getTokens(db);
        if (!ebayToken || !shopifyToken) {
            warn(`[Webhook] Missing tokens for auto-list`);
            markError(db, topic, 'Missing platform tokens');
            return;
        }
        try {
            const { syncProducts } = await import('../../sync/product-sync.js');
            const result = await syncProducts(ebayToken, shopifyToken, [productId]);
            if (result.created > 0) {
                info(`[Webhook] Auto-listed product ${productId} to eBay`);
                markProcessed(db, topic);
            }
            else if (result.failed > 0) {
                const errMsg = result.errors[0]?.error || 'Auto-list failed';
                warn(`[Webhook] Auto-list failed for ${productId}: ${errMsg}`);
                markError(db, topic, errMsg);
            }
            else {
                info(`[Webhook] Product ${productId} skipped by auto-list (already mapped or ineligible)`);
                markProcessed(db, topic);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logError(`[Webhook] products/create auto-list error for ${productId}: ${msg}`);
            markError(db, topic, msg);
        }
    }
    else {
        info(`[Webhook] Auto-list disabled — product ${productId} logged only`);
        markProcessed(db, topic);
    }
    // Fire auto-listing pipeline in background (AI description + category)
    // This runs regardless of auto_list setting — it just pre-populates overrides
    import('../../sync/auto-listing-pipeline.js')
        .then(({ autoListProduct }) => autoListProduct(productId))
        .then((result) => {
        if (result.success) {
            info(`[Webhook] Auto-listing pipeline completed for ${productId}: category=${result.categoryId}`);
        }
        else {
            warn(`[Webhook] Auto-listing pipeline failed for ${productId}: ${result.error}`);
        }
    })
        .catch((err) => {
        logError(`[Webhook] Auto-listing pipeline error for ${productId}: ${err}`);
    });
}
// ---------------------------------------------------------------------------
// 5. orders/fulfilled — unchanged, already implemented
// ---------------------------------------------------------------------------
async function handleOrderFulfilled(body) {
    const shopifyOrderId = String(body?.id);
    const shopifyOrderName = body?.name;
    info(`[Shopify Webhook] Order fulfilled: ${shopifyOrderName} (${shopifyOrderId})`);
    try {
        // Find the corresponding eBay order
        const db = await getRawDb();
        const mapping = db.prepare(`SELECT * FROM order_mappings WHERE shopify_order_id = ?`).get(shopifyOrderId);
        if (!mapping) {
            info(`[Webhook] No eBay mapping found for Shopify order ${shopifyOrderName}`);
            return;
        }
        const ebayOrderId = mapping.ebay_order_id;
        // Get eBay token
        const ebayTokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'ebay'`).get();
        if (!ebayTokenRow?.access_token) {
            warn(`[Webhook] No eBay token found for fulfillment sync`);
            return;
        }
        // Extract tracking info from fulfillments
        const fulfillments = body?.fulfillments || [];
        if (fulfillments.length === 0) {
            warn(`[Webhook] No fulfillments found in order ${shopifyOrderName}`);
            return;
        }
        const fulfillment = fulfillments[0]; // Use first fulfillment
        const trackingNumber = fulfillment?.tracking_number;
        const carrier = fulfillment?.tracking_company;
        if (!trackingNumber) {
            warn(`[Webhook] No tracking number found for order ${shopifyOrderName}`);
            return;
        }
        // Create eBay shipping fulfillment
        info(`[Webhook] Creating eBay fulfillment: ${ebayOrderId} → tracking ${trackingNumber}`);
        const { createShippingFulfillment } = await import('../../ebay/fulfillment.js');
        const { mapShippingCarrier } = await import('../../sync/mapper.js');
        // Get all line items for the order (eBay requires this)
        const ebayOrder = await import('../../ebay/fulfillment.js').then(mod => mod.fetchEbayOrder(ebayTokenRow.access_token, ebayOrderId));
        const fulfillmentData = {
            lineItems: ebayOrder.lineItems.map(item => ({
                lineItemId: item.lineItemId,
                quantity: item.quantity,
            })),
            shippedDate: new Date().toISOString(),
            shippingCarrierCode: mapShippingCarrier(carrier || 'OTHER'),
            trackingNumber,
        };
        const fulfillmentResult = await createShippingFulfillment(ebayTokenRow.access_token, ebayOrderId, fulfillmentData);
        info(`[Webhook] eBay fulfillment created: ${fulfillmentResult.fulfillmentId} for order ${ebayOrderId}`);
        // Update local mapping status
        db.prepare(`UPDATE order_mappings SET status = 'fulfilled' WHERE ebay_order_id = ?`).run(ebayOrderId);
    }
    catch (err) {
        logError(`[Webhook] Fulfillment sync error for ${shopifyOrderName}: ${err}`);
    }
}
export default router;
