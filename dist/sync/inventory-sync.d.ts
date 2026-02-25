export interface InventorySyncResult {
    processed: number;
    updated: number;
    skipped: number;
    failed: number;
    errors: Array<{
        sku: string;
        error: string;
    }>;
}
/**
 * Update eBay inventory quantity for a specific SKU.
 * CRITICAL: If quantity is 0, the eBay listing MUST be ended (withdrawn).
 * If quantity goes from 0 to >0, the listing is republished.
 */
export declare const updateEbayInventory: (ebayToken: string, sku: string, quantity: number, options?: {
    dryRun?: boolean;
}) => Promise<{
    success: boolean;
    error?: string;
    action?: string;
}>;
/**
 * Sync inventory levels for all mapped products.
 */
export declare const syncAllInventory: (ebayToken: string, shopifyToken: string, options?: {
    dryRun?: boolean;
}) => Promise<InventorySyncResult>;
/**
 * Handle Shopify inventory webhook update.
 * Called when a product variant's inventory changes in Shopify.
 */
export declare const handleInventoryWebhook: (ebayToken: string, productId: string, variantId: string, newQuantity: number) => Promise<void>;
