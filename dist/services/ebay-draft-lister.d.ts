/**
 * eBay Draft Lister Service
 *
 * Handles creating a live eBay listing from an approved draft.
 * Single-product, explicit-action-only. NO batch, NO auto-publish.
 *
 * Flow:
 *   1. Load draft + Shopify product data
 *   2. Build eBay inventory item (prefer draft content over live Shopify)
 *   3. Ensure eBay location exists
 *   4. Create/replace inventory item on eBay
 *   5. Create offer
 *   6. Publish offer → get listingId
 *   7. Save product_mapping, update draft, log to sync_log
 */
export interface EbayListingPreview {
    sku: string;
    title: string;
    description: string;
    condition: string;
    conditionDescription?: string;
    categoryId: string;
    categoryName: string;
    price: string;
    currency: string;
    quantity: number;
    imageUrls: string[];
    brand: string;
    mpn: string;
    aspects: Record<string, string[]>;
    policies: {
        fulfillmentPolicyId: string;
        fulfillmentPolicyName: string;
        paymentPolicyId: string;
        paymentPolicyName: string;
        returnPolicyId: string;
        returnPolicyName: string;
    };
    merchantLocationKey: string;
}
export interface ListOnEbayResult {
    success: boolean;
    listingId?: string;
    offerId?: string;
    sku?: string;
    error?: string;
}
/**
 * Optional overrides passed from the eBay listing prep page.
 * Any field here takes precedence over system-generated values.
 */
export interface ListingOverrides {
    title?: string;
    price?: number;
    categoryId?: string;
    condition?: string;
    aspects?: Record<string, string[]>;
    description?: string;
    imageUrls?: string[];
}
/**
 * Build a preview of what would be sent to eBay without actually doing it.
 */
export declare const previewEbayListing: (draftId: number) => Promise<{
    success: boolean;
    preview?: EbayListingPreview;
    error?: string;
}>;
/**
 * Create a live eBay listing from a draft.
 * Updates the draft with the eBay listing ID and logs to sync_log.
 *
 * SAFETY: Single product only. No auto-trigger. Must be called explicitly.
 *
 * @param overrides  Optional values from the listing prep UI that override system defaults.
 */
export declare const listDraftOnEbay: (draftId: number, overrides?: ListingOverrides) => Promise<ListOnEbayResult>;
