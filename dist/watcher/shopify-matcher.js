/**
 * shopify-matcher.ts — Search Shopify products to find a match for a
 * product name + serial suffix parsed from a StyleShoots folder name.
 *
 * Strategy (multi-pass with decreasing confidence):
 *   1. Exact substring match on title + serial suffix → "exact"
 *   2. Token overlap match on title (>= 70% of tokens) → "fuzzy"
 *   3. Serial-only match on SKU suffix → "fuzzy"
 *   4. No match → null
 *
 * Caches the full Shopify product list and refreshes every 5 minutes.
 */
import { getRawDb } from '../db/client.js';
import { fetchAllShopifyProductsOverview } from '../shopify/products.js';
import { info, warn } from '../utils/logger.js';
// ── Product Cache ──────────────────────────────────────────────────────
let cachedProducts = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
async function getProducts(options) {
    const now = Date.now();
    if (cachedProducts && (now - cacheTimestamp) < CACHE_TTL) {
        return cachedProducts;
    }
    const db = await getRawDb();
    const row = db
        .prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`)
        .get();
    if (!row?.access_token) {
        throw new Error('Shopify access token not found — cannot search products');
    }
    info('[ShopifyMatcher] Refreshing product cache from Shopify...');
    // Always fetch both active and draft for caching; filtering happens at match time
    cachedProducts = await fetchAllShopifyProductsOverview(row.access_token, { includeDrafts: true });
    cacheTimestamp = now;
    info(`[ShopifyMatcher] Cached ${cachedProducts.length} products`);
    return cachedProducts;
}
/**
 * Force-refresh the product cache (e.g., after a new product is created).
 */
export function invalidateProductCache() {
    cachedProducts = null;
    cacheTimestamp = 0;
}
// ── Matching Logic ─────────────────────────────────────────────────────
/**
 * Tokenize a string for comparison.
 * Lowercases, splits on whitespace/hyphens/special chars, removes empty tokens.
 */
function tokenize(str) {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9\s\-\.]/g, ' ')
        .split(/[\s\-]+/)
        .filter(t => t.length > 0);
}
/**
 * Calculate token overlap ratio: how many query tokens are found in the target.
 */
function tokenOverlap(queryTokens, targetTokens) {
    if (queryTokens.length === 0)
        return 0;
    const targetSet = new Set(targetTokens);
    let matches = 0;
    for (const token of queryTokens) {
        // Exact token match
        if (targetSet.has(token)) {
            matches++;
            continue;
        }
        // Partial match (query token is substring of a target token or vice versa)
        for (const target of targetTokens) {
            if (target.includes(token) || token.includes(target)) {
                matches += 0.5;
                break;
            }
        }
    }
    return matches / queryTokens.length;
}
/**
 * Search Shopify products for a match based on folder name parsing.
 *
 * @param productName - Parsed product name (e.g., "sigma 24-70")
 * @param serialSuffix - Parsed serial suffix (e.g., "624"), or null
 * @returns The best match, or null if no good match found
 */
export async function searchShopifyProduct(productName, serialSuffix, options) {
    const products = await getProducts(options);
    const queryTokens = tokenize(productName);
    const allowedStatuses = new Set(['active']);
    if (options?.includeDrafts)
        allowedStatuses.add('draft');
    // ── Pass 1: Exact substring match (title contains product name) ──
    // If serial suffix present, also check title or SKU contains it
    const titleMatches = [];
    for (const product of products) {
        if (!allowedStatuses.has(product.status))
            continue;
        const titleLower = product.title.toLowerCase();
        const nameLower = productName.toLowerCase();
        // Check if the title contains the full product name
        if (titleLower.includes(nameLower)) {
            let score = 1.0;
            if (serialSuffix) {
                // Check if serial is in title or SKU
                const serialInTitle = titleLower.includes(`#${serialSuffix}`) ||
                    titleLower.includes(serialSuffix);
                const serialInSku = product.variants.some(v => v.sku && v.sku.endsWith(serialSuffix));
                if (serialInTitle || serialInSku) {
                    score = 1.5; // Boost for serial match
                }
            }
            titleMatches.push({ product, score });
        }
    }
    // Sort by score descending
    titleMatches.sort((a, b) => b.score - a.score);
    if (titleMatches.length > 0) {
        const best = titleMatches[0];
        if (titleMatches.length > 1) {
            warn(`[ShopifyMatcher] Multiple title matches for "${productName}" — picking best: ${best.product.title}`);
        }
        return {
            id: best.product.id,
            title: best.product.title,
            confidence: best.score >= 1.5 ? 'exact' : 'exact',
        };
    }
    // ── Pass 2: Token overlap match ──────────────────────────────────
    const tokenMatches = [];
    for (const product of products) {
        if (!allowedStatuses.has(product.status))
            continue;
        const titleTokens = tokenize(product.title);
        const overlap = tokenOverlap(queryTokens, titleTokens);
        if (overlap >= 0.7) {
            tokenMatches.push({ product, overlap });
        }
    }
    tokenMatches.sort((a, b) => b.overlap - a.overlap);
    if (tokenMatches.length > 0) {
        const best = tokenMatches[0];
        if (tokenMatches.length > 1) {
            warn(`[ShopifyMatcher] Multiple fuzzy matches for "${productName}" — picking best (${(best.overlap * 100).toFixed(0)}% overlap): ${best.product.title}`);
        }
        return {
            id: best.product.id,
            title: best.product.title,
            confidence: 'fuzzy',
        };
    }
    // ── Pass 3: Serial-only match (SKU suffix) ──────────────────────
    if (serialSuffix) {
        for (const product of products) {
            if (!allowedStatuses.has(product.status))
                continue;
            const skuMatch = product.variants.some(v => v.sku && v.sku.endsWith(serialSuffix));
            if (skuMatch) {
                return {
                    id: product.id,
                    title: product.title,
                    confidence: 'fuzzy',
                };
            }
        }
    }
    // ── Pass 4: No match ────────────────────────────────────────────
    return null;
}
