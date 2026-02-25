/**
 * Get a valid eBay access token, auto-refreshing if expired.
 * Returns null if no token exists or refresh fails.
 */
export declare const getValidEbayToken: () => Promise<string | null>;
/**
 * Get a valid Shopify access token.
 */
export declare const getValidShopifyToken: () => Promise<string | null>;
