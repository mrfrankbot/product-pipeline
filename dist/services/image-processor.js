import { info, warn } from '../utils/logger.js';
import { getImageService, timedImageCall } from './image-service-factory.js';
/**
 * Orchestrates product image processing for listings.
 *
 * Uses the configured image processing service (self-hosted or PhotoRoom)
 * via the factory. If no service is available, returns original URLs.
 */
export async function processProductImages(shopifyProduct) {
    const images = shopifyProduct?.images ?? [];
    if (images.length === 0) {
        warn('[ImageProcessor] Product has no images — nothing to process');
        return [];
    }
    const imageUrls = images.map((img) => img.src);
    let imageService;
    try {
        imageService = await getImageService();
    }
    catch {
        warn('[ImageProcessor] No image service available — returning original image URLs');
        return imageUrls;
    }
    info(`[ImageProcessor] Processing ${imageUrls.length} images`);
    const processedBuffers = await timedImageCall(`batch ${imageUrls.length} images`, () => imageService.processAllImages(imageUrls, {
        background: 'FFFFFF',
        shadow: true,
        padding: 0.1,
    }));
    // Convert buffers to base64 data URLs so they can be used directly
    const dataUrls = processedBuffers.map((buf) => {
        const base64 = buf.toString('base64');
        return `data:image/png;base64,${base64}`;
    });
    info(`[ImageProcessor] Returned ${dataUrls.length} processed images as data URLs`);
    return dataUrls;
}
/**
 * Upload processed images back to Shopify.
 *
 * TODO: Implement actual Shopify image upload via Admin API.
 */
export async function uploadToShopify(productId, imageBuffers) {
    info(`[ImageProcessor] uploadToShopify stub called for product ${productId} with ${imageBuffers.length} images — not yet implemented`);
    return [];
}
