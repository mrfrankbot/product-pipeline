import { Router, type Request, type Response } from 'express';
import { getRawDb } from '../../db/client.js';
import { getImageService, timedImageCall } from '../../services/image-service-factory.js';
import { info, error as logError, warn } from '../../utils/logger.js';

const router = Router();

// ── Helper: get Shopify token ──────────────────────────────────────────

async function getShopifyToken(): Promise<string | null> {
  const db = await getRawDb();
  const row = db.prepare(
    `SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`,
  ).get() as any;
  return row?.access_token ?? null;
}

// ── Helper: fetch product images from Shopify ──────────────────────────

async function fetchShopifyProductImages(
  accessToken: string,
  productId: string,
): Promise<Array<{ id: number; src: string; position: number; alt: string | null }>> {
  const res = await fetch(
    `https://usedcameragear.myshopify.com/admin/api/2024-01/products/${productId}/images.json`,
    { headers: { 'X-Shopify-Access-Token': accessToken } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify image fetch failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as any;
  return (data.images ?? []).map((img: any) => ({
    id: img.id,
    src: img.src,
    position: img.position,
    alt: img.alt ?? null,
  }));
}

// ── Helper: upload processed image back to Shopify ─────────────────────

async function uploadProcessedImageToShopify(
  accessToken: string,
  productId: string,
  imageBuffer: Buffer,
  filename: string,
): Promise<any> {
  const base64 = imageBuffer.toString('base64');
  const res = await fetch(
    `https://usedcameragear.myshopify.com/admin/api/2024-01/products/${productId}/images.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: { attachment: base64, filename } }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify image upload failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as any;
  return data.image;
}

// ────────────────────────────────────────────────────────────────────────
// GET /api/products/:id/images — List all images (original + processed)
// ────────────────────────────────────────────────────────────────────────

router.get('/api/products/:id/images', async (req: Request, res: Response) => {
  try {
    const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const accessToken = await getShopifyToken();
    if (!accessToken) {
      res.status(400).json({ error: 'Shopify token not configured' });
      return;
    }

    // Fetch current Shopify images
    const shopifyImages = await fetchShopifyProductImages(accessToken, productId);

    // Fetch processing log from DB
    const db = await getRawDb();
    const logRows = db.prepare(
      `SELECT * FROM image_processing_log WHERE product_id = ? ORDER BY created_at DESC`,
    ).all(productId) as any[];

    // Build a map from original URL to latest processing entry
    const processingByUrl = new Map<string, any>();
    for (const row of logRows) {
      if (!processingByUrl.has(row.original_url)) {
        processingByUrl.set(row.original_url, row);
      }
    }

    const images = shopifyImages.map((img) => {
      const processing = processingByUrl.get(img.src);
      return {
        id: img.id,
        position: img.position,
        originalUrl: img.src,
        alt: img.alt,
        processedUrl: processing?.processed_url ?? null,
        processingStatus: processing?.status ?? 'original',
        params: processing?.params_json ? JSON.parse(processing.params_json) : null,
        processedAt: processing?.updated_at ?? null,
      };
    });

    res.json({
      ok: true,
      productId,
      images,
      totalOriginal: shopifyImages.length,
      totalProcessed: images.filter((i) => i.processedUrl).length,
      processingLog: logRows.slice(0, 20), // recent history
    });
  } catch (err) {
    logError(`[Images API] Failed to list images: ${err}`);
    res.status(500).json({ error: 'Failed to list images', detail: String(err) });
  }
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/products/:id/images/reprocess — Reprocess single image
// Body: { imageUrl, background?, padding?, shadow? }
// ────────────────────────────────────────────────────────────────────────

router.post('/api/products/:id/images/reprocess', async (req: Request, res: Response) => {
  try {
    const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { imageUrl, background, padding, shadow } = req.body;

    if (!imageUrl) {
      res.status(400).json({ error: 'imageUrl required in request body' });
      return;
    }

    const params = {
      background: background ?? '#FFFFFF',
      padding: typeof padding === 'number' ? padding : 0.1,
      shadow: typeof shadow === 'boolean' ? shadow : true,
    };

    const db = await getRawDb();
    const now = Math.floor(Date.now() / 1000);

    // Insert a processing log entry
    const insertResult = db.prepare(
      `INSERT INTO image_processing_log (product_id, image_url, original_url, status, params_json, created_at, updated_at)
       VALUES (?, ?, ?, 'processing', ?, ?, ?)`,
    ).run(productId, imageUrl, imageUrl, JSON.stringify(params), now, now);
    const logId = insertResult.lastInsertRowid;

    info(`[Images API] Reprocessing image for product ${productId} (log ${logId})`);

    try {
      const imageService = await getImageService();
      const { dataUrl } = await timedImageCall(
        `reprocess product=${productId}`,
        () => imageService.processWithParams(imageUrl, params),
      );

      // Update log entry with success
      db.prepare(
        `UPDATE image_processing_log SET status = 'completed', processed_url = ?, updated_at = ? WHERE id = ?`,
      ).run(dataUrl, Math.floor(Date.now() / 1000), logId);

      // Optionally upload back to Shopify
      const accessToken = await getShopifyToken();
      let shopifyImage = null;
      if (accessToken) {
        try {
          const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
          shopifyImage = await uploadProcessedImageToShopify(
            accessToken,
            productId,
            buffer,
            `processed-${Date.now()}.png`,
          );
          info(`[Images API] Uploaded processed image to Shopify: ${shopifyImage?.id}`);
        } catch (uploadErr) {
          warn(`[Images API] Failed to upload to Shopify (non-fatal): ${uploadErr}`);
        }
      }

      res.json({
        ok: true,
        logId: Number(logId),
        productId,
        originalUrl: imageUrl,
        processedUrl: dataUrl,
        params,
        shopifyImage: shopifyImage ? { id: shopifyImage.id, src: shopifyImage.src } : null,
      });
    } catch (processErr) {
      // Update log entry with error
      db.prepare(
        `UPDATE image_processing_log SET status = 'error', error = ?, updated_at = ? WHERE id = ?`,
      ).run(String(processErr), Math.floor(Date.now() / 1000), logId);

      throw processErr;
    }
  } catch (err) {
    logError(`[Images API] Reprocess failed: ${err}`);
    res.status(500).json({ error: 'Image reprocessing failed', detail: String(err) });
  }
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/products/:id/images/reprocess-all — Reprocess all images
// Body: { background?, padding?, shadow? }
// ────────────────────────────────────────────────────────────────────────

router.post('/api/products/:id/images/reprocess-all', async (req: Request, res: Response) => {
  try {
    const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { background, padding, shadow } = req.body;

    const accessToken = await getShopifyToken();
    if (!accessToken) {
      res.status(400).json({ error: 'Shopify token not configured' });
      return;
    }

    const params = {
      background: background ?? '#FFFFFF',
      padding: typeof padding === 'number' ? padding : 0.1,
      shadow: typeof shadow === 'boolean' ? shadow : true,
    };

    // Fetch product images from Shopify
    const shopifyImages = await fetchShopifyProductImages(accessToken, productId);

    if (shopifyImages.length === 0) {
      res.status(400).json({ error: 'Product has no images to process' });
      return;
    }

    info(`[Images API] Reprocessing ALL ${shopifyImages.length} images for product ${productId}`);

    const db = await getRawDb();
    const imageService = await getImageService();
    const results: Array<{
      originalUrl: string;
      processedUrl: string | null;
      status: string;
      error?: string;
      shopifyImageId?: number;
    }> = [];

    for (const img of shopifyImages) {
      const now = Math.floor(Date.now() / 1000);
      const insertResult = db.prepare(
        `INSERT INTO image_processing_log (product_id, image_url, original_url, status, params_json, created_at, updated_at)
         VALUES (?, ?, ?, 'processing', ?, ?, ?)`,
      ).run(productId, img.src, img.src, JSON.stringify(params), now, now);
      const logId = insertResult.lastInsertRowid;

      try {
        const { buffer, dataUrl } = await timedImageCall(
          `reprocess-all product=${productId} image=${img.id}`,
          () => imageService.processWithParams(img.src, params),
        );

        db.prepare(
          `UPDATE image_processing_log SET status = 'completed', processed_url = ?, updated_at = ? WHERE id = ?`,
        ).run(dataUrl, Math.floor(Date.now() / 1000), logId);

        // Upload to Shopify
        let shopifyImageId: number | undefined;
        try {
          const shopifyImage = await uploadProcessedImageToShopify(
            accessToken,
            productId,
            buffer,
            `processed-${img.id}-${Date.now()}.png`,
          );
          shopifyImageId = shopifyImage?.id;
        } catch (uploadErr) {
          warn(`[Images API] Shopify upload failed for image ${img.id}: ${uploadErr}`);
        }

        results.push({
          originalUrl: img.src,
          processedUrl: dataUrl,
          status: 'completed',
          shopifyImageId,
        });
      } catch (processErr) {
        db.prepare(
          `UPDATE image_processing_log SET status = 'error', error = ?, updated_at = ? WHERE id = ?`,
        ).run(String(processErr), Math.floor(Date.now() / 1000), logId);

        results.push({
          originalUrl: img.src,
          processedUrl: null,
          status: 'error',
          error: String(processErr),
        });
      }
    }

    const succeeded = results.filter((r) => r.status === 'completed').length;
    const failed = results.filter((r) => r.status === 'error').length;

    // Update pipeline status
    db.prepare(
      `INSERT INTO product_pipeline_status (shopify_product_id, images_processed, images_processed_count, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?)
       ON CONFLICT(shopify_product_id) DO UPDATE SET
         images_processed = 1,
         images_processed_count = excluded.images_processed_count,
         updated_at = excluded.updated_at`,
    ).run(productId, succeeded, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));

    res.json({
      ok: true,
      productId,
      total: shopifyImages.length,
      succeeded,
      failed,
      params,
      results,
    });
  } catch (err) {
    logError(`[Images API] Reprocess-all failed: ${err}`);
    res.status(500).json({ error: 'Bulk image reprocessing failed', detail: String(err) });
  }
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/products/:id/images/:imageId/status — Check processing status
// ────────────────────────────────────────────────────────────────────────

router.get('/api/products/:id/images/:imageId/status', async (req: Request, res: Response) => {
  try {
    const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const imageId = Array.isArray(req.params.imageId) ? req.params.imageId[0] : req.params.imageId;

    const db = await getRawDb();

    // imageId could be a Shopify image ID or a processing log ID
    // Try processing log first
    let logRow = db.prepare(
      `SELECT * FROM image_processing_log WHERE id = ? AND product_id = ?`,
    ).get(imageId, productId) as any;

    if (!logRow) {
      // Try to find by matching Shopify image URL pattern
      const rows = db.prepare(
        `SELECT * FROM image_processing_log WHERE product_id = ? ORDER BY created_at DESC`,
      ).all(productId) as any[];

      logRow = rows.find(
        (r: any) => r.image_url.includes(imageId) || r.original_url.includes(imageId),
      );
    }

    if (!logRow) {
      res.json({
        ok: true,
        productId,
        imageId,
        status: 'original',
        message: 'No processing record found — image has not been processed',
      });
      return;
    }

    res.json({
      ok: true,
      productId,
      imageId,
      logId: logRow.id,
      status: logRow.status,
      originalUrl: logRow.original_url,
      processedUrl: logRow.processed_url,
      params: logRow.params_json ? JSON.parse(logRow.params_json) : null,
      error: logRow.error,
      createdAt: logRow.created_at,
      updatedAt: logRow.updated_at,
    });
  } catch (err) {
    logError(`[Images API] Status check failed: ${err}`);
    res.status(500).json({ error: 'Failed to check image status', detail: String(err) });
  }
});

// ────────────────────────────────────────────────────────────────────────
// DELETE /api/products/:productId/images/:imageId — Delete image from Shopify
// ────────────────────────────────────────────────────────────────────────

router.delete('/api/products/:productId/images/:imageId', async (req: Request, res: Response) => {
  try {
    const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
    const imageId = Array.isArray(req.params.imageId) ? req.params.imageId[0] : req.params.imageId;

    const accessToken = await getShopifyToken();
    if (!accessToken) {
      res.status(400).json({ error: 'Shopify token not configured' });
      return;
    }

    info(`[Images API] Deleting image ${imageId} from product ${productId}`);

    // Delete from Shopify
    const deleteResponse = await fetch(
      `https://usedcameragear.myshopify.com/admin/api/2024-01/products/${productId}/images/${imageId}.json`,
      {
        method: 'DELETE',
        headers: { 'X-Shopify-Access-Token': accessToken },
      },
    );

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      logError(`[Images API] Shopify delete failed (${deleteResponse.status}): ${errorText}`);
      res.status(deleteResponse.status).json({ 
        error: 'Failed to delete image from Shopify', 
        detail: errorText 
      });
      return;
    }

    // Clean up local processing log entries for this image
    const db = await getRawDb();
    db.prepare(
      `DELETE FROM image_processing_log WHERE product_id = ? AND image_url LIKE ?`,
    ).run(productId, `%${imageId}%`);

    info(`[Images API] Successfully deleted image ${imageId} from product ${productId}`);
    res.json({ ok: true, productId, imageId, deleted: true });
  } catch (err) {
    logError(`[Images API] Delete failed: ${err}`);
    res.status(500).json({ error: 'Image deletion failed', detail: String(err) });
  }
});

// ────────────────────────────────────────────────────────────────────────
// DELETE /api/products/:productId/images — Bulk delete images from Shopify
// Body: { imageIds: number[] }
// ────────────────────────────────────────────────────────────────────────

router.delete('/api/products/:productId/images', async (req: Request, res: Response) => {
  try {
    const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
    const { imageIds } = req.body;

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      res.status(400).json({ error: 'imageIds array required in request body' });
      return;
    }

    const accessToken = await getShopifyToken();
    if (!accessToken) {
      res.status(400).json({ error: 'Shopify token not configured' });
      return;
    }

    info(`[Images API] Bulk deleting ${imageIds.length} images from product ${productId}`);

    const results: Array<{ id: number; success: boolean; error?: string }> = [];

    // Delete each image from Shopify
    for (const imageId of imageIds) {
      try {
        const deleteResponse = await fetch(
          `https://usedcameragear.myshopify.com/admin/api/2024-01/products/${productId}/images/${imageId}.json`,
          {
            method: 'DELETE',
            headers: { 'X-Shopify-Access-Token': accessToken },
          },
        );

        if (deleteResponse.ok) {
          results.push({ id: imageId, success: true });
        } else {
          const errorText = await deleteResponse.text();
          results.push({ id: imageId, success: false, error: errorText });
        }
      } catch (err) {
        results.push({ id: imageId, success: false, error: String(err) });
      }
    }

    // Clean up local processing log entries for deleted images
    const db = await getRawDb();
    const successfulIds = results.filter(r => r.success).map(r => r.id);
    for (const imageId of successfulIds) {
      db.prepare(
        `DELETE FROM image_processing_log WHERE product_id = ? AND image_url LIKE ?`,
      ).run(productId, `%${imageId}%`);
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    info(`[Images API] Bulk delete complete: ${succeeded} succeeded, ${failed} failed`);
    res.json({ 
      ok: true, 
      productId, 
      total: imageIds.length,
      succeeded, 
      failed, 
      results 
    });
  } catch (err) {
    logError(`[Images API] Bulk delete failed: ${err}`);
    res.status(500).json({ error: 'Bulk image deletion failed', detail: String(err) });
  }
});

// ── Image proxy (CORS-free access to GCS images) ──────────────────────

const GCS_BUCKET_NAME = 'pictureline-product-photos';

/**
 * Extract the GCS object path from a raw or signed GCS URL.
 * Handles both:
 *   - Raw: https://storage.googleapis.com/BUCKET/object/path.png
 *   - Signed: https://storage.googleapis.com/BUCKET/object/path.png?X-Goog-...
 */
function extractGcsObjectPath(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    // pathname = /BUCKET/object/path.png
    const prefix = `/${GCS_BUCKET_NAME}/`;
    if (parsed.pathname.startsWith(prefix)) {
      return decodeURIComponent(parsed.pathname.slice(prefix.length));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate a fresh signed URL for a GCS object, bypassing DRIVE_MODE check.
 */
async function signGcsObject(objectPath: string): Promise<string> {
  const { Storage } = await import('@google-cloud/storage');
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  let storage: InstanceType<typeof Storage>;
  if (credsJson) {
    const credentials = JSON.parse(credsJson);
    storage = new Storage({ projectId: credentials.project_id, credentials });
  } else {
    storage = new Storage({ projectId: process.env.GCS_PROJECT_ID });
  }
  const [url] = await storage.bucket(GCS_BUCKET_NAME).file(objectPath).getSignedUrl({
    action: 'read' as const,
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
    version: 'v4',
  });
  return url;
}

router.get('/api/images/proxy', async (req: Request, res: Response) => {
  const url = req.query.url as string;
  const wantClean = req.query.clean === 'true';
  if (!url || (!url.startsWith('https://storage.googleapis.com/') && !url.startsWith('https://storage.cloud.google.com/'))) {
    return res.status(400).json({ error: 'Only GCS URLs allowed' });
  }

  try {
    // Extract the object path from any GCS URL (raw or signed)
    let objectPath = extractGcsObjectPath(url);
    if (!objectPath) {
      return res.status(400).json({ error: 'Could not parse GCS object path from URL' });
    }

    // For clean=true, rewrite path: processed/123_0.png → processed/123_0_clean.png
    if (wantClean) {
      objectPath = objectPath.replace(/(_\d+)(\.png)$/i, '$1_clean$2');
    }

    // Generate a fresh signed URL and fetch through it
    const signedUrl = await signGcsObject(objectPath);
    const upstream = await fetch(signedUrl);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
    }
    const contentType = upstream.headers.get('content-type') || 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    logError(`[Image Proxy] Failed: ${err}`);
    res.status(502).json({ error: 'Proxy fetch failed' });
  }
});

export default router;
