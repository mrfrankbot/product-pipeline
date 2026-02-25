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
export interface MatchResult {
    id: string;
    title: string;
    confidence: 'exact' | 'fuzzy';
}
/**
 * Force-refresh the product cache (e.g., after a new product is created).
 */
export declare function invalidateProductCache(): void;
/**
 * Search Shopify products for a match based on folder name parsing.
 *
 * @param productName - Parsed product name (e.g., "sigma 24-70")
 * @param serialSuffix - Parsed serial suffix (e.g., "624"), or null
 * @returns The best match, or null if no good match found
 */
export declare function searchShopifyProduct(productName: string, serialSuffix: string | null, options?: {
    includeDrafts?: boolean;
}): Promise<MatchResult | null>;
