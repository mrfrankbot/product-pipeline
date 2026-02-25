export interface ProductSyncResult {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    errors: Array<{
        productId: string;
        error: string;
    }>;
}
/**
 * Sync multiple Shopify products to eBay.
 */
export declare const syncProducts: (ebayToken: string, shopifyToken: string, productIds: string[], settings?: Record<string, string>, options?: {
    dryRun?: boolean;
    draft?: boolean;
}) => Promise<ProductSyncResult>;
/**
 * Auto-sync new Shopify products to eBay based on settings.
 */
export declare const autoSyncNewProducts: (ebayToken: string, shopifyToken: string, settings?: Record<string, string>) => Promise<ProductSyncResult>;
/**
 * Update an existing eBay listing from Shopify product data.
 * Updates inventory item (title, description, images, etc.) and offer (price).
 * Does NOT delete/recreate the offer — preserves listing history.
 */
export declare const updateProductOnEbay: (ebayToken: string, shopifyToken: string, productId: string, settings?: Record<string, string>) => Promise<{
    success: boolean;
    error?: string;
    updated: string[];
}>;
/**
 * End an eBay listing when a Shopify product is deleted/archived.
 * Withdraws the offer and updates mapping status to 'ended'.
 */
export declare const endEbayListing: (ebayToken: string, productId: string) => Promise<{
    success: boolean;
    error?: string;
}>;
