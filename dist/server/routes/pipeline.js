import { Router } from 'express';
import { getRawDb } from '../../db/client.js';
import { info, error as logError } from '../../utils/logger.js';
import { pipelineEvents } from '../../sync/pipeline-status.js';
const router = Router();
/**
 * GET /api/pipeline/jobs
 * List all pipeline jobs (most recent first).
 */
router.get('/api/pipeline/jobs', async (req, res) => {
    try {
        const db = await getRawDb();
        const productId = req.query.productId?.trim();
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const rows = productId
            ? db
                .prepare(`SELECT * FROM pipeline_jobs WHERE shopify_product_id = ? ORDER BY created_at DESC LIMIT ?`)
                .all(productId, limit)
            : db
                .prepare(`SELECT * FROM pipeline_jobs ORDER BY created_at DESC LIMIT ?`)
                .all(limit);
        const jobs = rows.map((row) => ({
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
    }
    catch (err) {
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
            .get(req.params.id);
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
        const row = db.prepare(`SELECT * FROM pipeline_jobs WHERE id = ?`).get(jobId);
        if (row) {
            const steps = row.steps_json ? JSON.parse(row.steps_json) : [];
            res.write(`data: ${JSON.stringify({ type: 'snapshot', job: { id: row.id, status: row.status, currentStep: row.current_step, shopifyTitle: row.shopify_title, steps, startedAt: row.started_at, completedAt: row.completed_at, error: row.error } })}\n\n`);
        }
    }).catch(() => { });
    const handler = (event) => {
        try {
            res.write(`data: ${JSON.stringify({ type: 'step', ...event })}\n\n`);
            if (event.jobStatus === 'completed' || event.jobStatus === 'failed') {
                res.write(`data: ${JSON.stringify({ type: 'complete', jobId, status: event.jobStatus, shopifyTitle: event.shopifyTitle })}\n\n`);
            }
        }
        catch { /* client disconnected */ }
    };
    pipelineEvents.on(`job:${jobId}`, handler);
    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        }
        catch {
            clearInterval(heartbeat);
        }
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
    const handler = (event) => {
        try {
            res.write(`data: ${JSON.stringify({ type: 'step', ...event })}\n\n`);
        }
        catch { }
    };
    pipelineEvents.on('job:*', handler);
    const heartbeat = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        }
        catch {
            clearInterval(heartbeat);
        }
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
            .get();
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
    }
    catch (err) {
        logError(`[PipelineAPI] Drive search error: ${err}`);
        res.status(500).json({ error: 'Drive search failed', detail: String(err) });
    }
});
/**
 * POST /api/pipeline/trigger/:productId
 * Manually trigger the full pipeline for a single Shopify product.
 * Returns immediately with a jobId — the pipeline runs in the background.
 * Use SSE streams (GET /api/pipeline/jobs/:id/stream) to track progress.
 */
router.post('/api/pipeline/trigger/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        // Prevent duplicate runs — check if there's already an active job for this product
        const { getPipelineJobs } = await import('../../sync/pipeline-status.js');
        const existingJobs = getPipelineJobs();
        const alreadyRunning = existingJobs.find((j) => j.shopifyProductId === productId && (j.status === 'processing' || j.status === 'queued'));
        if (alreadyRunning) {
            res.json({ success: false, error: 'Pipeline already running for this product', jobId: alreadyRunning.id });
            return;
        }
        info(`[PipelineAPI] Manual trigger for product ${productId} — starting in background`);
        const { autoListProduct } = await import('../../sync/auto-listing-pipeline.js');
        // Fire the pipeline in the background (don't await)
        autoListProduct(productId).catch((err) => {
            logError(`[PipelineAPI] Background pipeline failed for ${productId}: ${err}`);
            // autoListProduct already updates job status internally on failure
        });
        // Return immediately — client should use SSE stream for progress
        res.json({ success: true, status: 'queued', productId });
    }
    catch (err) {
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
    }
    else {
        res.status(404).json({ success: false, error: 'Job not found or already completed' });
    }
});
/**
 * POST /api/pipeline/jobs/clear-stuck
 * Force-clear all stuck/processing jobs.
 */
router.post('/api/pipeline/jobs/clear-stuck', async (req, res) => {
    const { getPipelineJobs, cancelPipelineJob } = await import('../../sync/pipeline-status.js');
    const allJobs = getPipelineJobs();
    let cleared = 0;
    for (const job of allJobs) {
        if (job.status === 'processing' || job.status === 'queued') {
            cancelPipelineJob(job.id);
            cleared++;
        }
    }
    res.json({ success: true, cleared });
});
