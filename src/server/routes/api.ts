import { Router, type Request, type Response } from 'express';
import { getRawDb } from '../../db/client.js';
import { info } from '../../utils/logger.js';

const router = Router();

/** GET /api/status — Sync status overview */
router.get('/api/status', async (_req: Request, res: Response) => {
  try {
    const db = await getRawDb();

    const productCount = db.prepare(`SELECT COUNT(*) as count FROM product_mappings`).get() as any;
    const orderCount = db.prepare(`SELECT COUNT(*) as count FROM order_mappings`).get() as any;
    const lastSyncs = db.prepare(`SELECT * FROM sync_log ORDER BY id DESC LIMIT 5`).all();
    const recentNotifications = db.prepare(`SELECT * FROM notification_log ORDER BY id DESC LIMIT 10`).all();
    const settings = db.prepare(`SELECT * FROM settings`).all() as any[];

    res.json({
      status: 'running',
      products: { mapped: productCount?.count ?? 0 },
      orders: { imported: orderCount?.count ?? 0 },
      lastSyncs,
      recentNotifications,
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status', detail: String(err) });
  }
});

/** GET /api/listings — Paginated product listings with eBay status */
router.get('/api/listings', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const listings = db.prepare(`SELECT * FROM product_mappings ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset);
    const total = db.prepare(`SELECT COUNT(*) as count FROM product_mappings`).get() as any;

    res.json({ data: listings, total: total?.count ?? 0, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch listings', detail: String(err) });
  }
});

/** GET /api/orders — Recent imported orders */
router.get('/api/orders', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const orders = db.prepare(`SELECT * FROM order_mappings ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset);
    const total = db.prepare(`SELECT COUNT(*) as count FROM order_mappings`).get() as any;

    res.json({ data: orders, total: total?.count ?? 0, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders', detail: String(err) });
  }
});

/** GET /api/logs — Sync and notification logs */
router.get('/api/logs', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const source = req.query.source as string;

    let logs;
    if (source) {
      logs = db.prepare(`SELECT * FROM notification_log WHERE source = ? ORDER BY id DESC LIMIT ?`).all(source, limit);
    } else {
      logs = db.prepare(`SELECT * FROM notification_log ORDER BY id DESC LIMIT ?`).all(limit);
    }

    res.json({ data: logs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs', detail: String(err) });
  }
});

/** GET /api/settings — Current settings */
router.get('/api/settings', async (_req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const settings = db.prepare(`SELECT * FROM settings`).all() as any[];
    res.json(Object.fromEntries(settings.map((s) => [s.key, s.value])));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings', detail: String(err) });
  }
});

/** PUT /api/settings — Update settings */
router.put('/api/settings', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const updates = req.body as Record<string, string>;
    const stmt = db.prepare(
      `INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
    );

    for (const [key, value] of Object.entries(updates)) {
      stmt.run(key, String(value));
    }

    info(`[API] Settings updated: ${Object.keys(updates).join(', ')}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings', detail: String(err) });
  }
});

/** POST /api/sync/trigger — Manually trigger a full sync */
router.post('/api/sync/trigger', async (_req: Request, res: Response) => {
  info('[API] Manual sync triggered');
  res.json({ ok: true, message: 'Sync triggered' });

  try {
    const { runOrderSync } = await import('../sync-helper.js');
    const result = await runOrderSync({ dryRun: false });
    info(`[API] Manual sync complete: ${result?.imported ?? 0} orders imported`);
  } catch (err) {
    info(`[API] Manual sync error: ${err}`);
  }
});

export default router;
