/**
 * eBay Inventory API — manage inventory items and offers.
 * Docs: https://developer.ebay.com/api-docs/sell/inventory/resources/methods
 */
export interface EbayInventoryItem {
    sku: string;
    locale?: string;
    product: {
        title: string;
        description: string;
        imageUrls: string[];
        aspects?: Record<string, string[]>;
        brand?: string;
        mpn?: string;
        upc?: string[];
        ean?: string[];
    };
    condition: string;
    conditionDescription?: string;
    availability: {
        shipToLocationAvailability: {
            quantity: number;
        };
    };
    packageWeightAndSize?: {
        weight?: {
            value: number;
            unit: string;
        };
        dimensions?: {
            length: number;
            width: number;
            height: number;
            unit: string;
        };
    };
}
export interface EbayOffer {
    offerId?: string;
    sku: string;
    marketplaceId: string;
    format: string;
    listingDescription?: string;
    availableQuantity: number;
    pricingSummary: {
        price: {
            value: string;
            currency: string;
        };
    };
    listingPolicies: {
        fulfillmentPolicyId: string;
        paymentPolicyId: string;
        returnPolicyId: string;
    };
    categoryId: string;
    merchantLocationKey?: string;
    tax?: {
        applyTax: boolean;
    };
    status?: string;
    listingId?: string;
    listing?: {
        listingId?: string;
    };
}
export interface EbayOfferResponse {
    offerId: string;
    listingId?: string;
    statusCode?: number;
}
/**
 * Create or replace an inventory item on eBay.
 * PUT /sell/inventory/v1/inventory_item/{sku}
 */
export declare const createOrReplaceInventoryItem: (accessToken: string, sku: string, item: Omit<EbayInventoryItem, "sku">) => Promise<void>;
/**
 * Get an inventory item by SKU.
 */
export declare const getInventoryItem: (accessToken: string, sku: string) => Promise<EbayInventoryItem | null>;
/**
 * Get all inventory items with pagination.
 */
export declare const getInventoryItems: (accessToken: string, options?: {
    limit?: number;
    offset?: number;
}) => Promise<{
    inventoryItems: EbayInventoryItem[];
    total: number;
}>;
/**
 * Update the quantity of an inventory item.
 */
export declare const updateInventoryQuantity: (accessToken: string, sku: string, quantity: number) => Promise<void>;
/**
 * Create an offer for an inventory item.
 * POST /sell/inventory/v1/offer
 */
export declare const createOffer: (accessToken: string, offer: Omit<EbayOffer, "offerId">) => Promise<EbayOfferResponse>;
/**
 * Update an existing offer.
 * PUT /sell/inventory/v1/offer/{offerId}
 */
export declare const updateOffer: (accessToken: string, offerId: string, offer: Omit<EbayOffer, "offerId">) => Promise<void>;
/**
 * Get existing offers for a SKU.
 * GET /sell/inventory/v1/offer?sku={sku}
 */
export declare const getOffersBySku: (accessToken: string, sku: string) => Promise<{
    offers: EbayOffer[];
    total: number;
}>;
/**
 * Get seller's business policies (fulfillment, payment, return).
 * GET /sell/account/v1/fulfillment_policy, /payment_policy, /return_policy
 */
export declare const getBusinessPolicies: (accessToken: string) => Promise<{
    fulfillmentPolicyId: string;
    fulfillmentPolicyName: string;
    paymentPolicyId: string;
    paymentPolicyName: string;
    returnPolicyId: string;
    returnPolicyName: string;
}>;
/**
 * Delete an offer.
 * DELETE /sell/inventory/v1/offer/{offerId}
 */
export declare const deleteOffer: (accessToken: string, offerId: string) => Promise<void>;
/**
 * Create or update an inventory location on eBay.
 * PUT /sell/inventory/v1/location/{merchantLocationKey}
 */
export declare const createOrUpdateLocation: (accessToken: string, locationKey: string, location: {
    name: string;
    location: {
        address: {
            addressLine1: string;
            city: string;
            stateOrProvince: string;
            postalCode: string;
            country: string;
        };
    };
    merchantLocationStatus: string;
    locationTypes: string[];
}) => Promise<void>;
/**
 * Get an inventory location.
 */
export declare const getLocation: (accessToken: string, locationKey: string) => Promise<any | null>;
/**
 * Publish an offer (makes it a live listing on eBay).
 * POST /sell/inventory/v1/offer/{offerId}/publish
 */
export declare const publishOffer: (accessToken: string, offerId: string) => Promise<{
    listingId: string;
}>;
/**
 * Get offers for a SKU.
 */
export declare const getOffers: (accessToken: string, sku: string) => Promise<{
    offers: EbayOffer[];
    total: number;
}>;
/**
 * Delete an inventory item.
 */
export declare const deleteInventoryItem: (accessToken: string, sku: string) => Promise<void>;
/**
 * Withdraw (end) an offer — takes the listing off eBay but keeps inventory item.
 * POST /sell/inventory/v1/offer/{offerId}/withdraw
 */
export declare const withdrawOffer: (accessToken: string, offerId: string) => Promise<void>;
/**
 * Get an offer by its ID.
 * GET /sell/inventory/v1/offer/{offerId}
 */
export declare const getOffer: (accessToken: string, offerId: string) => Promise<EbayOffer | null>;
