export interface PriceSyncResult {
    updated: number;
    skipped: number;
    failed: number;
    errors: Array<{
        sku: string;
        error: string;
    }>;
}
/**
 * Sync prices from Shopify to eBay.
 * Compares Shopify variant prices with eBay offer prices and updates if different.
 */
export declare const syncPrices: (ebayAccessToken: string, shopifyAccessToken: string, options?: {
    dryRun?: boolean;
}) => Promise<PriceSyncResult>;
