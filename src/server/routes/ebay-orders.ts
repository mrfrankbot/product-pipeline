import { Router, type Request, type Response } from 'express';
import { getRawDb } from '../../db/client.js';
import { getValidEbayToken } from '../../ebay/token-manager.js';
import { fetchAllEbayOrders } from '../../ebay/fulfillment.js';
import { info, error as logError } from '../../utils/logger.js';

const router = Router();

/** GET /api/ebay/orders/stats — aggregate counts */
router.get('/api/ebay/orders/stats', async (_req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const total = (db.prepare(`SELECT COUNT(*) as count FROM ebay_orders`).get() as any)?.count ?? 0;
    const byFulfillment = db.prepare(
      `SELECT fulfillment_status, COUNT(*) as count FROM ebay_orders GROUP BY fulfillment_status`
    ).all() as Array<{ fulfillment_status: string; count: number }>;
    const byPayment = db.prepare(
      `SELECT payment_status, COUNT(*) as count FROM ebay_orders GROUP BY payment_status`
    ).all() as Array<{ payment_status: string; count: number }>;
    const syncedCount = (db.prepare(`SELECT COUNT(*) as count FROM ebay_orders WHERE synced_to_shopify = 1`).get() as any)?.count ?? 0;
    const lastImport = (db.prepare(`SELECT MAX(imported_at) as ts FROM ebay_orders`).get() as any)?.ts ?? null;

    res.json({
      total,
      synced: syncedCount,
      unsynced: total - syncedCount,
      lastImportedAt: lastImport,
      byFulfillmentStatus: Object.fromEntries(byFulfillment.map(r => [r.fulfillment_status ?? 'UNKNOWN', r.count])),
      byPaymentStatus: Object.fromEntries(byPayment.map(r => [r.payment_status ?? 'UNKNOWN', r.count])),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats', detail: String(err) });
  }
});

/** GET /api/ebay/orders — list with pagination, search, filters */
router.get('/api/ebay/orders', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string || '').trim();
    const fulfillmentStatus = (req.query.fulfillmentStatus as string || '').trim();
    const paymentStatus = (req.query.paymentStatus as string || '').trim();
    const synced = req.query.synced as string | undefined;

    const conditions: string[] = [];
    const params: any[] = [];

    if (search) {
      conditions.push(`(ebay_order_id LIKE ? OR legacy_order_id LIKE ? OR buyer_username LIKE ?)`);
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (fulfillmentStatus) {
      conditions.push(`fulfillment_status = ?`);
      params.push(fulfillmentStatus);
    }
    if (paymentStatus) {
      conditions.push(`payment_status = ?`);
      params.push(paymentStatus);
    }
    if (synced === '1' || synced === '0') {
      conditions.push(`synced_to_shopify = ?`);
      params.push(parseInt(synced));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM ebay_orders ${where}`).get(...params) as any;
    const rows = db.prepare(
      `SELECT id, ebay_order_id, legacy_order_id, buyer_username, order_status, fulfillment_status, payment_status, total_amount, currency, item_count, line_items_json, shipping_address_json, ebay_created_at, ebay_modified_at, synced_to_shopify, shopify_order_id, imported_at FROM ebay_orders ${where} ORDER BY imported_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({ data: rows, total: countRow?.count ?? 0, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch eBay orders', detail: String(err) });
  }
});

/** GET /api/ebay/orders/:id — single order detail */
router.get('/api/ebay/orders/:id', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const row = db.prepare(`SELECT * FROM ebay_orders WHERE id = ?`).get(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order', detail: String(err) });
  }
});

/** POST /api/ebay/orders/import — fetch from eBay API and upsert */
router.post('/api/ebay/orders/import', async (req: Request, res: Response) => {
  try {
    const { days = 30, limit, fulfillmentStatus, confirm = false } = req.body || {};
    const dryRun = !confirm; // DRY RUN by default
    
    const token = await getValidEbayToken();
    if (!token) {
      res.status(401).json({ error: 'No valid eBay token. Please authenticate first.' });
      return;
    }

    // SAFETY GUARD: Limit historical lookback
    const maxDays = 30;
    const safeDays = Math.min(days, maxDays);
    if (days > maxDays) {
      info(`[EbayOrders] SAFETY: Limiting lookback from ${days} to ${maxDays} days`);
    }

    const createdAfter = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
    info(`[EbayOrders] Importing orders from last ${safeDays} days (since ${createdAfter}) | Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

    if (dryRun) {
      res.json({ 
        success: true, 
        message: 'DRY RUN: Would import orders. Pass confirm=true in request body to actually import.',
        dryRun: true,
        days: safeDays,
        createdAfter
      });
      return;
    }

    const orders = await fetchAllEbayOrders(token, { createdAfter });
    const db = await getRawDb();

    const upsert = db.prepare(`
      INSERT INTO ebay_orders (
        ebay_order_id, legacy_order_id, buyer_username, order_status,
        fulfillment_status, payment_status, total_amount, currency,
        item_count, line_items_json, shipping_address_json,
        ebay_created_at, ebay_modified_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ebay_order_id) DO UPDATE SET
        order_status = excluded.order_status,
        fulfillment_status = excluded.fulfillment_status,
        payment_status = excluded.payment_status,
        total_amount = excluded.total_amount,
        item_count = excluded.item_count,
        line_items_json = excluded.line_items_json,
        shipping_address_json = excluded.shipping_address_json,
        ebay_modified_at = excluded.ebay_modified_at,
        raw_json = excluded.raw_json
    `);

    let imported = 0;
    let updated = 0;

    const insertMany = db.transaction(() => {
      for (const order of orders) {
        const shippingAddress = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo ?? null;
        const result = upsert.run(
          order.orderId,
          order.legacyOrderId ?? null,
          order.buyer?.username ?? null,
          order.cancelStatus?.cancelState ?? 'NONE',
          order.orderFulfillmentStatus,
          order.orderPaymentStatus,
          parseFloat(order.pricingSummary?.total?.value ?? '0'),
          order.pricingSummary?.total?.currency ?? 'USD',
          order.lineItems?.length ?? 0,
          JSON.stringify(order.lineItems ?? []),
          shippingAddress ? JSON.stringify(shippingAddress) : null,
          order.creationDate,
          order.lastModifiedDate,
          JSON.stringify(order),
        );
        if (result.changes > 0) {
          // SQLite: lastInsertRowid > 0 for inserts; for updates changes=1 but we can't easily distinguish
          imported++;
        }
      }
    });

    insertMany();

    info(`[EbayOrders] Import complete: ${orders.length} fetched, ${imported} upserted`);
    res.json({ success: true, fetched: orders.length, upserted: imported });
  } catch (err) {
    logError(`[EbayOrders] Import failed: ${err}`);
    res.status(500).json({ error: 'Import failed', detail: String(err) });
  }
});

export default router;
