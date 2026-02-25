export declare function processNewProduct(shopifyProduct: any): Promise<{
    description: string;
    ebayCategory: string;
    ready: boolean;
}>;
/**
 * Process product images via PhotoRoom template rendering.
 *
 * If PHOTOROOM_API_KEY is not set, falls back to returning the original
 * Shopify image URLs (no processing). Processed images are saved to a local
 * temp directory and their file paths are returned.
 */
export declare function processProductImages(shopifyProduct: any): Promise<string[]>;
export declare function autoListProduct(shopifyProductId: string): Promise<{
    success: boolean;
    jobId?: string;
    description?: string;
    categoryId?: string;
    images?: string[];
    error?: string;
}>;
