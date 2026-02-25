/**
 * Orchestrates product image processing for listings.
 *
 * Uses the configured image processing service (self-hosted or PhotoRoom)
 * via the factory. If no service is available, returns original URLs.
 */
export declare function processProductImages(shopifyProduct: any): Promise<string[]>;
/**
 * Upload processed images back to Shopify.
 *
 * TODO: Implement actual Shopify image upload via Admin API.
 */
export declare function uploadToShopify(productId: string, imageBuffers: Buffer[]): Promise<string[]>;
