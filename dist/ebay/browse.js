import { ebayRequest } from './client.js';
/**
 * Search eBay listings (uses application token, not user token).
 */
export const searchEbayListings = async (accessToken, query, options = {}) => {
    const params = new URLSearchParams();
    params.set('q', query);
    if (options.limit)
        params.set('limit', String(options.limit));
    if (options.offset)
        params.set('offset', String(options.offset));
    if (options.categoryId)
        params.set('category_ids', options.categoryId);
    return ebayRequest({
        path: `/buy/browse/v1/item_summary/search?${params.toString()}`,
        accessToken,
        headers: { 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
    });
};
/**
 * Get a specific eBay item by ID.
 */
export const getEbayItem = async (accessToken, itemId) => {
    return ebayRequest({
        path: `/buy/browse/v1/item/${itemId}`,
        accessToken,
        headers: { 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
    });
};
