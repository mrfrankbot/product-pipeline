export type ShopifyProduct = {
    id: string;
    title: string;
    handle: string;
    status: string;
};
export type ShopifyDetailedProduct = {
    id: string;
    title: string;
    handle: string;
    status: string;
    description: string;
    descriptionHtml: string;
    productType: string;
    vendor: string;
    tags: string[];
    images: Array<{
        id: string;
        url: string;
        altText?: string;
    }>;
    variants: Array<{
        id: string;
        sku: string;
        title: string;
        price: string;
        compareAtPrice?: string;
        inventoryQuantity: number;
        weight: number;
        weightUnit: string;
        requiresShipping: boolean;
    }>;
    options: Array<{
        id: string;
        name: string;
        values: string[];
    }>;
    createdAt: string;
    updatedAt: string;
};
export type ShopifyOverviewProduct = {
    id: string;
    title: string;
    status: string;
    images: Array<{
        id: string;
        src: string;
        alt?: string;
    }>;
    variants: Array<{
        id: string;
        sku: string;
        price: string;
    }>;
};
export declare const fetchShopifyProducts: (accessToken: string, first?: number) => Promise<ShopifyProduct[]>;
/**
 * Fetch all Shopify products with enough detail for overview tables.
 */
export declare const fetchAllShopifyProductsOverview: (accessToken: string, options?: {
    includeDrafts?: boolean;
}) => Promise<ShopifyOverviewProduct[]>;
/**
 * Fetch detailed product information via REST API for eBay listing creation.
 */
export declare const fetchDetailedShopifyProduct: (accessToken: string, productId: string) => Promise<ShopifyDetailedProduct | null>;
/**
 * Fetch products with pagination via REST API.
 */
export declare const fetchAllShopifyProducts: (accessToken: string, options?: {
    limit?: number;
    sinceId?: string;
    status?: string;
}) => Promise<ShopifyProduct[]>;
