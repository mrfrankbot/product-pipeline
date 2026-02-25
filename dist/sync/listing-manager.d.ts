/**
 * AI Listing Management — actively manages eBay listings for optimal performance.
 *
 * Features:
 *   1. Stale listing auto-republish (withdraw → republish after N days)
 *   2. Price drop schedule (reduce price on listings with no sales)
 *   3. Listing health dashboard data
 *   4. Promoted Listings setup via eBay Marketing API
 */
export interface RepublishResult {
    processed: number;
    republished: number;
    skipped: number;
    failed: number;
    errors: Array<{
        sku: string;
        error: string;
    }>;
}
/**
 * Republish stale listings to give them a fresh boost in the eBay algorithm.
 * Withdraws the offer, waits briefly, then re-publishes it.
 *
 * @param ebayToken  Valid eBay access token
 * @param maxAgeDays Listings older than this are considered stale (default: 30)
 */
export declare function republishStaleListings(ebayToken: string, maxAgeDays?: number): Promise<RepublishResult>;
export interface PriceDropResult {
    processed: number;
    dropped: number;
    skipped: number;
    failed: number;
    errors: Array<{
        sku: string;
        error: string;
    }>;
}
/**
 * Apply automatic price drops to listings that haven't sold within a threshold.
 *
 * Settings (from DB):
 *   - price_drop_after_days (default 14)
 *   - price_drop_percent   (default 10)
 *
 * Tracks original price in productMappings.original_price so drops don't compound.
 */
export declare function applyPriceDropSchedule(ebayToken: string, _shopifyToken?: string): Promise<PriceDropResult>;
/**
 * Get listings eligible for actions (stale/price drop).
 */
export declare function getStaleListings(maxAgeDays?: number): Promise<any[]>;
export interface ListingHealthData {
    totalActive: number;
    totalEnded: number;
    ageBuckets: {
        '0-7d': number;
        '7-14d': number;
        '14-30d': number;
        '30d+': number;
    };
    averageDaysListed: number;
    priceDropped: number;
    republished: number;
    promoted: number;
    revenue: number;
}
export declare function getListingHealth(): Promise<ListingHealthData>;
export interface PromoteResult {
    processed: number;
    promoted: number;
    failed: number;
    errors: Array<{
        listingId: string;
        error: string;
    }>;
    campaignId?: string;
}
/**
 * Enable Promoted Listings Standard for the given listing IDs.
 *
 * Uses the eBay Marketing API — Promoted Listings Standard (cost-per-sale).
 * Creates a single campaign (or reuses if one exists) and adds listings to it.
 *
 * @param ebayToken   Valid eBay access token with sell.marketing scope
 * @param listingIds  Array of eBay listing IDs to promote
 * @param adRate      Ad rate percentage (default 2.0 = 2%)
 */
export declare function enablePromotedListings(ebayToken: string, listingIds: string[], adRate?: number): Promise<PromoteResult>;
/**
 * Run all AI listing management tasks. Called by the scheduler.
 */
export declare function runListingManagement(ebayToken: string): Promise<{
    republish: RepublishResult;
    priceDrop: PriceDropResult;
}>;
