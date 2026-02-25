/**
 * eBay Account API — manage business policies.
 * Used to get fulfillment, payment, and return policies for listing creation.
 */
export interface EbayPolicy {
    policyId: string;
    name: string;
    description?: string;
    marketplaceId: string;
}
/**
 * Get fulfillment policies for the seller.
 */
export declare const getFulfillmentPolicies: (accessToken: string, marketplaceId?: string) => Promise<{
    fulfillmentPolicies: EbayPolicy[];
}>;
/**
 * Get payment policies for the seller.
 */
export declare const getPaymentPolicies: (accessToken: string, marketplaceId?: string) => Promise<{
    paymentPolicies: EbayPolicy[];
}>;
/**
 * Get return policies for the seller.
 */
export declare const getReturnPolicies: (accessToken: string, marketplaceId?: string) => Promise<{
    returnPolicies: EbayPolicy[];
}>;
/**
 * Get all business policies (convenience wrapper).
 */
export declare const getAllPolicies: (accessToken: string, marketplaceId?: string) => Promise<{
    fulfillment: EbayPolicy[];
    payment: EbayPolicy[];
    returns: EbayPolicy[];
}>;
