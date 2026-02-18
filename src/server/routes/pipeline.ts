import { Router } from 'express';
import { getRawDb } from '../../db/client.js';
import { info, error as logError } from '../../utils/logger.js';
import { pipelineEvents, type PipelineEvent } from '../../sync/pipeline-status.js';

const router = Router();

/**
 * GET /api/pipeline/jobs
 * List all pipeline jobs (most recent first).
 */
router.get('/api/pipeline/jobs', async (req, res) => {
  try {
    const db = await getRawDb();
    const productId = (req.query.productId as string | undefined)?.trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    const rows = productId
      ? db
          .prepare(
            `SELECT * FROM pipeline_jobs WHERE shopify_product_id = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(productId, limit)
      : db
          .prepare(`SELECT * FROM pipeline_jobs ORDER BY created_at DESC LIMIT ?`)
          .all(limit);

    const jobs = (rows as any[]).map((row) => ({
      id: row.id,
      shopifyProductId: row.shopify_product_id,
      shopifyTitle: row.shopify_title,
      status: row.status,
      currentStep: row.current_step,
      steps: row.steps_json ? JSON.parse(row.steps_json) : [],
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({ jobs, count: jobs.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pipeline jobs', detail: String(err) });
  }
});

/**
 * GET /api/pipeline/jobs/:id
 * Get a single pipeline job by ID.
 */
router.get('/api/pipeline/jobs/:id', (req, res) => {
  getRawDb()
    .then((db) => {
      const row = db
        .prepare(`SELECT * FROM pipeline_jobs WHERE id = ?`)
        .get(req.params.id) as any;
      if (!row) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.json({
        id: row.id,
        shopifyProductId: row.shopify_product_id,
        shopifyTitle: row.shopify_title,
        status: row.status,
        currentStep: row.current_step,
        steps: row.steps_json ? JSON.parse(row.steps_json) : [],
        startedAt: row.started_at,
        completedAt: row.completed_at,
        error: row.error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    })
    .catch((err) => {
      res.status(500).json({ error: 'Failed to fetch job', detail: String(err) });
    });
});

/**
 * GET /api/pipeline/jobs/:id/stream
 * SSE stream for real-time pipeline job updates.
 */
router.get('/api/pipeline/jobs/:id/stream', (req, res) => {
  const jobId = req.params.id;
  info(`[SSE] Client connected for job ${jobId}`);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');

  // Send current state first
  getRawDb().then((db) => {
    const row = db.prepare(`SELECT * FROM pipeline_jobs WHERE id = ?`).get(jobId) as any;
    if (row) {
      const steps = row.steps_json ? JSON.parse(row.steps_json) : [];
      res.write(`data: ${JSON.stringify({ type: 'snapshot', job: { id: row.id, status: row.status, currentStep: row.current_step, shopifyTitle: row.shopify_title, steps, startedAt: row.started_at, completedAt: row.completed_at, error: row.error } })}\n\n`);
    }
  }).catch(() => {});

  const handler = (event: PipelineEvent) => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'step', ...event })}\n\n`);
      if (event.jobStatus === 'completed' || event.jobStatus === 'failed') {
        res.write(`data: ${JSON.stringify({ type: 'complete', jobId, status: event.jobStatus, shopifyTitle: event.shopifyTitle })}\n\n`);
      }
    } catch { /* client disconnected */ }
  };

  pipelineEvents.on(`job:${jobId}`, handler);

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 30000);

  req.on('close', () => {
    info(`[SSE] Client disconnected for job ${jobId}`);
    pipelineEvents.off(`job:${jobId}`, handler);
    clearInterval(heartbeat);
  });
});

/**
 * GET /api/pipeline/stream
 * SSE stream for ALL pipeline job updates (for toast notifications).
 */
router.get('/api/pipeline/stream', (req, res) => {
  info(`[SSE] Client connected for all jobs`);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');

  const handler = (event: PipelineEvent) => {
    try { res.write(`data: ${JSON.stringify({ type: 'step', ...event })}\n\n`); } catch {}
  };

  pipelineEvents.on('job:*', handler);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 30000);

  req.on('close', () => {
    pipelineEvents.off('job:*', handler);
    clearInterval(heartbeat);
  });
});

/**
 * GET /api/pipeline/drive-search/:productId
 * Search the StyleShoots drive for photos matching a Shopify product (preview only).
 */
router.get('/api/pipeline/drive-search/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    const db = await getRawDb();
    const tokenRow = db
      .prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`)
      .get() as { access_token: string } | undefined;

    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'Shopify token not found' });
      return;
    }

    const { fetchDetailedShopifyProduct } = await import('../../shopify/products.js');
    const product = await fetchDetailedShopifyProduct(tokenRow.access_token, productId);
    if (!product) {
      res.status(404).json({ error: 'Product not found in Shopify' });
      return;
    }

    const { searchDriveForProduct, isDriveMounted } = await import('../../watcher/drive-search.js');

    if (!isDriveMounted()) {
      res.json({ success: false, error: 'StyleShoots drive is not mounted', product: { id: product.id, title: product.title } });
      return;
    }

    // Extract serial suffix from SKU if available
    const sku = product.variants?.[0]?.sku ?? '';
    const skuSuffix = sku.match(/(\d{2,4})$/)?.[1] ?? null;

    const driveResult = await searchDriveForProduct(product.title, skuSuffix);

    res.json({
      success: !!driveResult,
      product: { id: product.id, title: product.title },
      drive: driveResult ? {
        folderPath: driveResult.folderPath,
        presetName: driveResult.presetName,
        folderName: driveResult.folderName,
        imageCount: driveResult.imagePaths.length,
      } : null,
    });
  } catch (err) {
    logError(`[PipelineAPI] Drive search error: ${err}`);
    res.status(500).json({ error: 'Drive search failed', detail: String(err) });
  }
});

/**
 * POST /api/pipeline/trigger/:productId
 * Manually trigger the full pipeline for a single Shopify product:
 * 1. Fetch product from Shopify (active or draft)
 * 2. Search StyleShoots drive for matching photos
 * 3. If found: create draft with photos, generate AI description, apply TIM tag
 * 4. Return full status
 */
router.post('/api/pipeline/trigger/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    // Prevent duplicate runs — check if there's already an active job for this product
    const { getPipelineJobs } = await import('../../sync/pipeline-status.js');
    const existingJobs = getPipelineJobs();
    const alreadyRunning = existingJobs.find(
      (j: any) => j.shopifyProductId === productId && (j.status === 'processing' || j.status === 'queued'),
    );
    if (alreadyRunning) {
      res.json({ success: false, error: 'Pipeline already running for this product', jobId: alreadyRunning.id });
      return;
    }

    info(`[PipelineAPI] Manual trigger for product ${productId}`);

    const db = await getRawDb();
    const tokenRow = db
      .prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`)
      .get() as { access_token: string } | undefined;

    if (!tokenRow?.access_token) {
      res.status(400).json({ success: false, error: 'Shopify token not found' });
      return;
    }

    // Step 1: Fetch product
    const { fetchDetailedShopifyProduct } = await import('../../shopify/products.js');
    const product = await fetchDetailedShopifyProduct(tokenRow.access_token, productId);
    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found in Shopify' });
      return;
    }

    info(`[PipelineAPI] Found product: ${product.title} (status: ${product.status})`);

    // Step 2: Search drive for photos
    const { searchDriveForProduct, isDriveMounted, getSignedUrls } = await import('../../watcher/drive-search.js');

    if (!isDriveMounted()) {
      res.json({ success: false, error: 'StyleShoots drive is not mounted', product: { id: product.id, title: product.title } });
      return;
    }

    const sku = product.variants?.[0]?.sku ?? '';
    const skuSuffix = sku.match(/(\d{2,4})$/)?.[1] ?? null;
    const driveResult = await searchDriveForProduct(product.title, skuSuffix);

    if (!driveResult) {
      res.json({
        success: false,
        error: 'No photos found on StyleShoots drive for this product',
        product: { id: product.id, title: product.title },
      });
      return;
    }

    // Get signed URLs for cloud images, or keep local paths
    driveResult.imagePaths = await getSignedUrls(driveResult.imagePaths);

    info(`[PipelineAPI] Found ${driveResult.imagePaths.length} photos in ${driveResult.presetName}/${driveResult.folderName}`);

    // Step 3: Create draft with photos (reuse watcher's draft-service)
    // NOTE: Don't save raw drive photos here — autoListProduct below will process
    // them through PhotoRoom and save the processed versions to the draft.
    // Saving raw photos here caused them to be pushed to Shopify unprocessed.

    // Step 4: Run AI description pipeline (also handles photo processing + draft creation)
    let descriptionGenerated = false;
    let descriptionPreview: string | undefined;
    let pipelineJobId: string | undefined;
    let processedImageCount = 0;
    let draftId: number | undefined;

    try {
      const { autoListProduct } = await import('../../sync/auto-listing-pipeline.js');
      const pipelineResult = await autoListProduct(product.id);
      descriptionGenerated = pipelineResult.success;
      descriptionPreview = pipelineResult.description;
      pipelineJobId = pipelineResult.jobId;
      processedImageCount = pipelineResult.images?.length ?? 0;
    } catch (err) {
      logError(`[PipelineAPI] Pipeline failed (non-fatal): ${err}`);
    }

    // Look up the draft created by autoListProduct
    try {
      const draftRow = db.prepare(
        `SELECT id FROM product_drafts WHERE shopify_product_id = ? ORDER BY created_at DESC LIMIT 1`,
      ).get(product.id) as { id: number } | undefined;
      draftId = draftRow?.id;
    } catch { /* non-fatal */ }

    // Step 5: Apply TIM condition tag
    let tagApplied = false;
    let conditionTag: string | undefined;

    try {
      const { findTimItemForProduct, formatConditionForPrompt } = await import('../../services/tim-matching.js');
      const skus = product.variants.map(v => v.sku).filter(Boolean);
      const timData = await findTimItemForProduct(skus);
      if (timData?.condition) {
        conditionTag = `Condition: ${timData.condition}`;
        tagApplied = true;
      }
    } catch (err) {
      logError(`[PipelineAPI] TIM tag lookup failed (non-fatal): ${err}`);
    }

    res.json({
      success: true,
      product: { id: product.id, title: product.title, status: product.status },
      photos: {
        found: true,
        count: driveResult.imagePaths.length,
        presetName: driveResult.presetName,
        folderName: driveResult.folderName,
      },
      draft: { id: draftId },
      description: {
        generated: descriptionGenerated,
        preview: descriptionPreview?.substring(0, 500),
      },
      condition: {
        tagApplied,
        tag: conditionTag,
      },
      pipelineJobId,
    });
  } catch (err) {
    logError(`[PipelineAPI] Trigger error: ${err}`);
    res.status(500).json({ success: false, error: 'Pipeline trigger failed', detail: String(err) });
  }
});

export default router;

/**
 * POST /api/pipeline/jobs/:id/cancel
 * Cancel a running or queued pipeline job.
 */
router.post('/api/pipeline/jobs/:id/cancel', async (req, res) => {
  const { cancelPipelineJob } = await import('../../sync/pipeline-status.js');
  const cancelled = cancelPipelineJob(req.params.id);
  if (cancelled) {
    res.json({ success: true, message: 'Job cancelled' });
  } else {
    res.status(404).json({ success: false, error: 'Job not found or already completed' });
  }
});
