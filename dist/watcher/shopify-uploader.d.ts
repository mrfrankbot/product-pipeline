/**
 * shopify-uploader.ts — Upload local JPEG files to a Shopify product as images.
 *
 * Uses Shopify's REST Admin API to upload product images with base64-encoded
 * file data (the "attachment" field).
 */
/**
 * Upload multiple local image files to a Shopify product.
 *
 * @param shopifyProductId - The numeric Shopify product ID
 * @param imagePaths - Array of local file paths (JPEGs)
 * @returns Number of successfully uploaded images
 */
export declare function uploadImagesToShopify(shopifyProductId: string, imagePaths: string[]): Promise<{
    uploaded: number;
    failed: number;
    imageUrls: string[];
}>;
