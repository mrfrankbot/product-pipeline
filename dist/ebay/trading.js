import { ebayRequest } from './client.js';
/**
 * Get fulfillment policies for the seller.
 */
export const getFulfillmentPolicies = async (accessToken, marketplaceId = 'EBAY_US') => {
    return ebayRequest({
        path: `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplaceId}`,
        accessToken,
    });
};
/**
 * Get payment policies for the seller.
 */
export const getPaymentPolicies = async (accessToken, marketplaceId = 'EBAY_US') => {
    return ebayRequest({
        path: `/sell/account/v1/payment_policy?marketplace_id=${marketplaceId}`,
        accessToken,
    });
};
/**
 * Get return policies for the seller.
 */
export const getReturnPolicies = async (accessToken, marketplaceId = 'EBAY_US') => {
    return ebayRequest({
        path: `/sell/account/v1/return_policy?marketplace_id=${marketplaceId}`,
        accessToken,
    });
};
/**
 * Get all business policies (convenience wrapper).
 */
export const getAllPolicies = async (accessToken, marketplaceId = 'EBAY_US') => {
    const [fulfillment, payment, returns] = await Promise.all([
        getFulfillmentPolicies(accessToken, marketplaceId),
        getPaymentPolicies(accessToken, marketplaceId),
        getReturnPolicies(accessToken, marketplaceId),
    ]);
    return {
        fulfillment: fulfillment.fulfillmentPolicies || [],
        payment: payment.paymentPolicies || [],
        returns: returns.returnPolicies || [],
    };
};
