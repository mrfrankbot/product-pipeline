import { info, warn } from '../utils/logger.js';
import { PhotoRoomService } from './photoroom.js';

/**
 * Orchestrates product image processing for listings.
 *
 * If PHOTOROOM_API_KEY is configured, images are processed through PhotoRoom
 * (background removal, white background, drop shadow). Otherwise the original
 * Shopify image URLs are returned unchanged with a warning.
 */

export async function processProductImages(
  shopifyProduct: any,
): Promise<string[]> {
  const images: Array<{ src: string }> = shopifyProduct?.images ?? [];

  if (images.length === 0) {
    warn('[ImageProcessor] Product has no images — nothing to process');
    return [];
  }

  const imageUrls = images.map((img) => img.src);

  const apiKey = process.env.PHOTOROOM_API_KEY;
  if (!apiKey) {
    warn(
      '[ImageProcessor] PHOTOROOM_API_KEY not set — returning original image URLs',
    );
    return imageUrls;
  }

  info(
    `[ImageProcessor] Processing ${imageUrls.length} images through PhotoRoom`,
  );
  const photoroom = new PhotoRoomService(apiKey);

  const processedBuffers = await photoroom.processAllImages(imageUrls, {
    background: 'FFFFFF',
    shadow: true,
    padding: 0.1,
  });

  // Convert buffers to base64 data URLs so they can be used directly
  const dataUrls = processedBuffers.map((buf) => {
    const base64 = buf.toString('base64');
    return `data:image/png;base64,${base64}`;
  });

  info(
    `[ImageProcessor] Returned ${dataUrls.length} processed images as data URLs`,
  );
  return dataUrls;
}

/**
 * Upload processed images back to Shopify.
 *
 * TODO: Implement actual Shopify image upload via Admin API.
 * For now this is a stub that logs and returns an empty array.
 */
export async function uploadToShopify(
  productId: string,
  imageBuffers: Buffer[],
): Promise<string[]> {
  // TODO: Use Shopify Admin API to upload images to the product
  //   POST /admin/api/2024-01/products/{productId}/images.json
  //   with { image: { attachment: <base64> } }
  info(
    `[ImageProcessor] uploadToShopify stub called for product ${productId} with ${imageBuffers.length} images — not yet implemented`,
  );
  return [];
}
