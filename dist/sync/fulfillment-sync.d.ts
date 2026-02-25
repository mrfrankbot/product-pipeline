export interface FulfillmentSyncResult {
    updated: number;
    skipped: number;
    failed: number;
    errors: Array<{
        orderId: string;
        error: string;
    }>;
}
/**
 * Sync fulfillments from Shopify to eBay.
 * When an order is shipped in Shopify, mark it shipped on eBay with tracking.
 */
export declare const syncFulfillments: (ebayAccessToken: string, shopifyAccessToken: string, options?: {
    dryRun?: boolean;
}) => Promise<FulfillmentSyncResult>;
