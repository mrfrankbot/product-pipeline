/**
 * TIM (TradeInManager) API Routes
 */
import { Router } from 'express';
import { fetchTimItems, clearTimCache } from '../../services/tim-service.js';
import { findTimItemBySku } from '../../services/tim-matching.js';
import { fetchDetailedShopifyProduct } from '../../shopify/products.js';
import { applyConditionTag } from '../../services/tim-tagging.js';
import { getRawDb } from '../../db/client.js';
import { error as logError } from '../../utils/logger.js';
const router = Router();
async function getShopifyAccessToken() {
    const db = await getRawDb();
    const row = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get();
    return row?.access_token ?? null;
}
/**
 * GET /api/tim/items — List all TIM items (debugging)
 */
router.get('/api/tim/items', async (req, res) => {
    try {
        const refresh = req.query.refresh === 'true';
        if (refresh)
            clearTimCache();
        const items = await fetchTimItems(refresh);
        res.json({ data: items, total: items.length });
    }
    catch (err) {
        logError(`[TIM Route] Failed to fetch items: ${err}`);
        res.status(500).json({ error: 'Failed to fetch TIM items' });
    }
});
/**
 * GET /api/tim/condition/:productId — Look up TIM condition for a Shopify product
 */
router.get('/api/tim/condition/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const accessToken = await getShopifyAccessToken();
        if (!accessToken) {
            res.status(500).json({ error: 'Shopify not connected' });
            return;
        }
        const pid = Array.isArray(productId) ? productId[0] : productId;
        // Fetch the Shopify product to get its SKU
        const product = await fetchDetailedShopifyProduct(accessToken, pid);
        if (!product) {
            res.status(404).json({ error: 'Shopify product not found' });
            return;
        }
        // Get SKUs from all variants
        const variants = product.variants ?? [];
        const skus = variants
            .map((v) => v.sku)
            .filter((s) => !!s);
        if (skus.length === 0) {
            res.json({ match: null, reason: 'Product has no SKUs' });
            return;
        }
        // Try to find a TIM match
        for (const sku of skus) {
            const match = await findTimItemBySku(sku);
            if (match) {
                res.json({ match, matchedSku: sku });
                return;
            }
        }
        res.json({ match: null, skusChecked: skus, reason: 'No TIM item matches' });
    }
    catch (err) {
        logError(`[TIM Route] Condition lookup failed: ${err}`);
        res.status(500).json({ error: 'Failed to look up TIM condition' });
    }
});
/**
 * POST /api/tim/tag/:productId — Look up TIM condition and apply tag to Shopify product
 */
router.post('/api/tim/tag/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const accessToken = await getShopifyAccessToken();
        if (!accessToken) {
            res.status(500).json({ error: 'Shopify not connected' });
            return;
        }
        const pid = Array.isArray(productId) ? productId[0] : productId;
        // Fetch the Shopify product to get its SKU
        const product = await fetchDetailedShopifyProduct(accessToken, pid);
        if (!product) {
            res.status(404).json({ error: 'Shopify product not found' });
            return;
        }
        // Get SKUs from all variants
        const variants = product.variants ?? [];
        const skus = variants
            .map((v) => v.sku)
            .filter((s) => !!s);
        if (skus.length === 0) {
            res.json({ success: false, error: 'Product has no SKUs' });
            return;
        }
        // Find TIM match
        let timCondition = null;
        for (const sku of skus) {
            const match = await findTimItemBySku(sku);
            if (match) {
                timCondition = match.condition;
                break;
            }
        }
        if (!timCondition) {
            res.json({ success: false, error: 'No TIM condition data found for this product' });
            return;
        }
        // Apply the tag
        const result = await applyConditionTag(accessToken, pid, timCondition);
        res.json({
            ...result,
            condition: timCondition,
        });
    }
    catch (err) {
        logError(`[TIM Route] Tagging failed: ${err}`);
        res.status(500).json({ error: 'Failed to tag product' });
    }
});
export default router;
