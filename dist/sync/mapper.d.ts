/**
 * Maps Shopify product condition tags to eBay condition values.
 * eBay Inventory API condition enum values.
 */
export declare const mapCondition: (tags: string[]) => string;
/**
 * Map Shopify product type to eBay category ID.
 * These are the most common camera gear categories on eBay.
 */
export declare const mapCategory: (productType: string) => string;
/**
 * Map Shopify shipping carrier names to eBay carrier codes.
 */
export declare const mapShippingCarrier: (carrier: string) => string;
/**
 * Clean and truncate title for eBay (80 char max).
 */
export declare const cleanTitle: (title: string) => string;
/**
 * Parse price string to number.
 */
export declare const parsePrice: (price: string) => number;
