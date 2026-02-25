/**
 * TIM SKU Matching Service
 * Matches Shopify product SKUs to TIM items
 */
import { fetchTimItems } from './tim-service.js';
/**
 * Find a TIM item matching a Shopify SKU.
 * Shopify used product SKUs follow pattern: {baseSKU}-U{serialSuffix}
 * TIM items have the same SKU format.
 */
export async function findTimItemBySku(shopifySku) {
    if (!shopifySku)
        return null;
    const items = await fetchTimItems();
    // Direct SKU match (case-insensitive)
    const normalizedSku = shopifySku.trim().toUpperCase();
    const match = items.find(item => item.sku && item.sku.trim().toUpperCase() === normalizedSku);
    if (!match)
        return null;
    return mapToConditionData(match);
}
/**
 * Find TIM item for a Shopify product by looking up its variant SKUs.
 * Takes an array of variant SKUs from the Shopify product.
 */
export async function findTimItemForProduct(variantSkus) {
    for (const sku of variantSkus) {
        const result = await findTimItemBySku(sku);
        if (result)
            return result;
    }
    return null;
}
function mapToConditionData(item) {
    return {
        timItemId: item.id,
        condition: item.condition,
        conditionNotes: item.conditionNotes,
        graderNotes: item.graderNotes,
        serialNumber: item.serialNumber,
        brand: item.brand,
        productName: item.productName,
        sku: item.sku,
        itemStatus: item.itemStatus,
    };
}
/**
 * Format TIM condition data for AI description prompt injection.
 */
const CONDITION_DESCRIPTIONS = {
    'like_new': 'Like New Minus — Looks like it just came out of the box. 99-100% of original condition.',
    'like_new_minus': 'Like New Minus — Looks like it just came out of the box. 99-100% of original condition.',
    'excellent_plus': 'Excellent Plus — Very little to no use, wear only visible under close inspection. 90-99% of original condition.',
    'excellent': 'Excellent — Normal signs of use appropriate for the age. 75-90% of original condition.',
    'good_plus': 'Good Plus — Visible wear but fully functional. 65-75% of original condition.',
    'good': 'Good Plus — Visible wear but fully functional. 65-75% of original condition.',
    'poor': 'Poor — Excessive wear, brassing, or finish loss but still operational. 50-65% of original condition.',
};
export function formatConditionForPrompt(data) {
    const parts = [];
    if (data.condition) {
        const desc = CONDITION_DESCRIPTIONS[data.condition];
        if (desc) {
            parts.push(`Condition Grade: ${desc}`);
        }
        else {
            const readable = data.condition.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            parts.push(`Condition Grade: ${readable}`);
        }
    }
    if (data.conditionNotes) {
        parts.push(`Grader's Condition Notes: ${data.conditionNotes}`);
    }
    if (data.graderNotes) {
        parts.push(`Grader Notes: ${data.graderNotes}`);
    }
    if (data.serialNumber) {
        parts.push(`Serial Number: ${data.serialNumber}`);
    }
    return parts.join('\n');
}
