/**
 * eBay Browse API — search and view listings.
 * Useful for checking if a listing exists on eBay.
 */
export interface EbayBrowseItem {
    itemId: string;
    title: string;
    price: {
        value: string;
        currency: string;
    };
    condition: string;
    image?: {
        imageUrl: string;
    };
    seller: {
        username: string;
    };
    itemWebUrl: string;
}
export interface EbaySearchResult {
    total: number;
    limit: number;
    offset: number;
    itemSummaries?: EbayBrowseItem[];
}
/**
 * Search eBay listings (uses application token, not user token).
 */
export declare const searchEbayListings: (accessToken: string, query: string, options?: {
    limit?: number;
    offset?: number;
    categoryId?: string;
}) => Promise<EbaySearchResult>;
/**
 * Get a specific eBay item by ID.
 */
export declare const getEbayItem: (accessToken: string, itemId: string) => Promise<EbayBrowseItem>;
