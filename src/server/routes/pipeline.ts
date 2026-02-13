import { Router } from 'express';
import { getRawDb } from '../../db/client.js';

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

export default router;
