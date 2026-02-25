export interface EbayOrderLineItem {
    lineItemId: string;
    legacyItemId: string;
    title: string;
    sku: string;
    quantity: number;
    lineItemCost: {
        value: string;
        currency: string;
    };
    deliveryCost?: {
        shippingCost?: {
            value: string;
            currency: string;
        };
    };
    lineItemFulfillmentStatus: string;
}
export interface EbayShippingAddress {
    fullName: string;
    contactAddress: {
        addressLine1: string;
        addressLine2?: string;
        city: string;
        stateOrProvince: string;
        postalCode: string;
        countryCode: string;
    };
    primaryPhone?: {
        phoneNumber: string;
    };
    email?: string;
}
export interface EbayOrder {
    orderId: string;
    legacyOrderId: string;
    creationDate: string;
    lastModifiedDate: string;
    orderFulfillmentStatus: string;
    orderPaymentStatus: string;
    pricingSummary: {
        total: {
            value: string;
            currency: string;
        };
        subtotal?: {
            value: string;
            currency: string;
        };
        deliveryCost?: {
            value: string;
            currency: string;
        };
        tax?: {
            value: string;
            currency: string;
        };
    };
    buyer: {
        username: string;
        taxAddress?: {
            stateOrProvince: string;
            postalCode: string;
            countryCode: string;
        };
    };
    fulfillmentStartInstructions: Array<{
        shippingStep: {
            shipTo: EbayShippingAddress;
            shippingCarrierCode?: string;
            shippingServiceCode?: string;
        };
    }>;
    lineItems: EbayOrderLineItem[];
    salesRecordReference?: string;
    cancelStatus?: {
        cancelState: string;
    };
}
export interface EbayOrdersResponse {
    href: string;
    total: number;
    limit: number;
    offset: number;
    orders: EbayOrder[];
    next?: string;
    prev?: string;
}
/**
 * Fetch eBay orders using the Fulfillment API.
 */
export declare const fetchEbayOrders: (accessToken: string, options?: {
    createdAfter?: string;
    modifiedAfter?: string;
    fulfillmentStatus?: string;
    limit?: number;
    offset?: number;
}) => Promise<EbayOrdersResponse>;
/**
 * Fetch ALL eBay orders with automatic pagination.
 */
export declare const fetchAllEbayOrders: (accessToken: string, options?: {
    createdAfter?: string;
    modifiedAfter?: string;
}) => Promise<EbayOrder[]>;
/**
 * Fetch a single eBay order by ID.
 */
export declare const fetchEbayOrder: (accessToken: string, orderId: string) => Promise<EbayOrder>;
export interface EbayShippingFulfillmentInput {
    lineItems: Array<{
        lineItemId: string;
        quantity: number;
    }>;
    shippedDate: string;
    shippingCarrierCode: string;
    trackingNumber: string;
}
/**
 * Create a shipping fulfillment for an eBay order.
 * POST /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment
 */
export declare const createShippingFulfillment: (accessToken: string, orderId: string, fulfillment: EbayShippingFulfillmentInput) => Promise<{
    fulfillmentId: string;
}>;
/**
 * Get shipping fulfillments for an eBay order.
 */
export declare const getShippingFulfillments: (accessToken: string, orderId: string) => Promise<{
    fulfillments: Array<{
        fulfillmentId: string;
        shippedDate: string;
        trackingNumber?: string;
    }>;
}>;
