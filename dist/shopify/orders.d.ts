export interface ShopifyOrderInput {
    source_name: string;
    source_identifier: string;
    note: string;
    tags: string;
    financial_status: 'paid' | 'pending';
    fulfillment_status: null | 'fulfilled';
    line_items: Array<{
        title: string;
        sku?: string;
        quantity: number;
        price: string;
        requires_shipping: boolean;
    }>;
    shipping_address: {
        first_name: string;
        last_name: string;
        address1: string;
        address2?: string;
        city: string;
        province: string;
        zip: string;
        country_code: string;
        phone?: string;
    };
    billing_address?: ShopifyOrderInput['shipping_address'];
    shipping_lines: Array<{
        title: string;
        price: string;
        code: string;
    }>;
    tax_lines?: Array<{
        title: string;
        price: string;
        rate: number;
    }>;
    send_receipt: false;
    send_fulfillment_receipt: false;
    suppress_notifications: true;
}
export interface ShopifyOrderResult {
    id: number;
    name: string;
    order_number: number;
}
/**
 * Create an order in Shopify via REST Admin API.
 */
export declare const createShopifyOrder: (accessToken: string, order: ShopifyOrderInput) => Promise<ShopifyOrderResult>;
/**
 * Check if an eBay order was already imported into Shopify.
 * Uses multiple search methods to prevent duplicates:
 * 1. Tag-based search (eBay-{orderId}) - for orders created by this app
 * 2. source_identifier search - for standards compliance
 * 3. Note content search - for orders created by legacy apps like Codisto
 */
export declare const findExistingShopifyOrder: (accessToken: string, ebayOrderId: string) => Promise<{
    id: number;
    name: string;
} | null>;
/**
 * Fetch recent Shopify orders (for listing/status).
 */
export declare const fetchShopifyOrders: (accessToken: string, options?: {
    limit?: number;
    status?: string;
    sinceId?: string;
}) => Promise<Array<{
    id: number;
    name: string;
    created_at: string;
    total_price: string;
    tags: string;
}>>;
