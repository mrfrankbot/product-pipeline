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

/** POST /api/sync/products — Sync Shopify products to eBay listings */
router.post('/api/sync/products', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const dryRun = req.query.dry === 'true';
    const productIds = req.body.productIds as string[];
    
    if (!Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ error: 'productIds array required in request body' });
      return;
    }
    
    // Get tokens
    const ebayRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'ebay'`).get() as any;
    const shopifyRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    
    if (!ebayRow?.access_token) {
      res.status(400).json({ error: 'eBay token not found. Complete OAuth first.' });
      return;
    }
    
    if (!shopifyRow?.access_token) {
      res.status(400).json({ error: 'Shopify token not found. Complete OAuth first.' });
      return;
    }
    
    // Get settings
    const settings = db.prepare(`SELECT * FROM settings`).all() as any[];
    const settingsObj = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    
    info(`[API] Product sync triggered: ${productIds.length} products${dryRun ? ' (DRY RUN)' : ''}`);
    res.json({ ok: true, message: 'Product sync triggered', productIds, dryRun });
    
    // Run sync in background
    try {
      const { syncProducts } = await import('../../sync/product-sync.js');
      const result = await syncProducts(
        ebayRow.access_token,
        shopifyRow.access_token,
        productIds,
        settingsObj,
        { dryRun }
      );
      info(`[API] Product sync complete: ${result.created} created, ${result.skipped} skipped, ${result.failed} failed`);
    } catch (err) {
      info(`[API] Product sync error: ${err}`);
    }
    
  } catch (err) {
    res.status(500).json({ error: 'Product sync failed', detail: String(err) });
  }
});

/** POST /api/sync/inventory — Sync inventory levels Shopify → eBay */
router.post('/api/sync/inventory', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const dryRun = req.query.dry === 'true';
    
    // Get tokens
    const ebayRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'ebay'`).get() as any;
    const shopifyRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    
    if (!ebayRow?.access_token) {
      res.status(400).json({ error: 'eBay token not found. Complete OAuth first.' });
      return;
    }
    
    if (!shopifyRow?.access_token) {
      res.status(400).json({ error: 'Shopify token not found. Complete OAuth first.' });
      return;
    }
    
    info(`[API] Inventory sync triggered${dryRun ? ' (DRY RUN)' : ''}`);
    res.json({ ok: true, message: 'Inventory sync triggered', dryRun });
    
    // Run sync in background
    try {
      const { syncAllInventory } = await import('../../sync/inventory-sync.js');
      const result = await syncAllInventory(
        ebayRow.access_token,
        shopifyRow.access_token,
        { dryRun }
      );
      info(`[API] Inventory sync complete: ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed`);
    } catch (err) {
      info(`[API] Inventory sync error: ${err}`);
    }
    
  } catch (err) {
    res.status(500).json({ error: 'Inventory sync failed', detail: String(err) });
  }
});

/** POST /api/listings/link — Manually link eBay listing to Shopify product */
router.post('/api/listings/link', async (req: Request, res: Response) => {
  try {
    const { shopifyProductId, ebayListingId, sku } = req.body;
    
    if (!shopifyProductId || !ebayListingId || !sku) {
      res.status(400).json({ error: 'shopifyProductId, ebayListingId, and sku are required' });
      return;
    }
    
    const db = await getRawDb();
    
    // Check if already linked
    const existing = db.prepare(
      `SELECT * FROM product_mappings WHERE shopify_product_id = ? OR ebay_listing_id = ?`
    ).get(shopifyProductId, ebayListingId) as any;
    
    if (existing) {
      res.status(400).json({ error: 'Product or listing already linked' });
      return;
    }
    
    // Create mapping
    db.prepare(
      `INSERT INTO product_mappings (shopify_product_id, ebay_listing_id, ebay_inventory_item_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'))`
    ).run(shopifyProductId, ebayListingId, sku);
    
    info(`[API] Manually linked: Shopify ${shopifyProductId} ↔ eBay ${ebayListingId} (SKU: ${sku})`);
    res.json({ ok: true, message: 'Listing linked successfully' });
    
  } catch (err) {
    res.status(500).json({ error: 'Failed to link listing', detail: String(err) });
  }
});

/** GET /api/mappings — List all mappings grouped by type */
router.get('/api/mappings', async (_req: Request, res: Response) => {
  try {
    const { getAllMappings } = await import('../../sync/mapping-service.js');
    const mappings = await getAllMappings();
    res.json(mappings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch mappings', detail: String(err) });
  }
});

/** GET /api/mappings/:type — List mappings of a specific type */
router.get('/api/mappings/:type', async (req: Request, res: Response) => {
  try {
    const mappingType = Array.isArray(req.params.type) ? req.params.type[0] : req.params.type;
    const { getMappingsByType } = await import('../../sync/mapping-service.js');
    const mappings = await getMappingsByType(mappingType);
    res.json({ data: mappings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch mappings', detail: String(err) });
  }
});

/** POST /api/mappings — Create a new mapping */
router.post('/api/mappings', async (req: Request, res: Response) => {
  try {
    const { mappingType, sourceValue, targetValue, isDefault } = req.body;
    
    if (!mappingType || !targetValue) {
      res.status(400).json({ error: 'mappingType and targetValue are required' });
      return;
    }
    
    const { createMapping } = await import('../../sync/mapping-service.js');
    const mapping = await createMapping(
      mappingType,
      sourceValue || null,
      targetValue,
      Boolean(isDefault)
    );
    
    info(`[API] Created mapping: ${mappingType} ${sourceValue} → ${targetValue}`);
    res.json(mapping);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create mapping', detail: String(err) });
  }
});

/** PUT /api/mappings/:id — Update a mapping */
router.put('/api/mappings/:id', async (req: Request, res: Response) => {
  try {
    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(idParam);
    const { sourceValue, targetValue, isDefault } = req.body;
    
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid mapping ID' });
      return;
    }
    
    const { updateMapping } = await import('../../sync/mapping-service.js');
    const mapping = await updateMapping(id, {
      sourceValue: sourceValue !== undefined ? sourceValue : undefined,
      targetValue,
      isDefault: isDefault !== undefined ? Boolean(isDefault) : undefined,
    });
    
    if (!mapping) {
      res.status(404).json({ error: 'Mapping not found' });
      return;
    }
    
    info(`[API] Updated mapping ${id}: ${mapping.sourceValue} → ${mapping.targetValue}`);
    res.json(mapping);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update mapping', detail: String(err) });
  }
});

/** DELETE /api/mappings/:id — Delete a mapping */
router.delete('/api/mappings/:id', async (req: Request, res: Response) => {
  try {
    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(idParam);
    
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid mapping ID' });
      return;
    }
    
    const { deleteMapping } = await import('../../sync/mapping-service.js');
    const deleted = await deleteMapping(id);
    
    if (!deleted) {
      res.status(404).json({ error: 'Mapping not found' });
      return;
    }
    
    info(`[API] Deleted mapping ${id}`);
    res.json({ ok: true, message: 'Mapping deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete mapping', detail: String(err) });
  }
});

/** POST /api/sync/trigger — Manually trigger a full sync */
router.post('/api/sync/trigger', async (req: Request, res: Response) => {
  const since = req.query.since as string;
  const dryRun = req.query.dry === 'true';
  
  info(`[API] Manual sync triggered${since ? ` (since: ${since})` : ''}${dryRun ? ' (DRY RUN)' : ''}`);
  res.json({ ok: true, message: 'Sync triggered', since, dryRun });

  try {
    const { runOrderSync } = await import('../sync-helper.js');
    const result = await runOrderSync({ 
      dryRun, 
      since: since || undefined  // Use since param or fall back to default 24h
    });
    info(`[API] Manual sync complete: ${result?.imported ?? 0} orders imported, ${result?.skipped ?? 0} skipped, ${result?.failed ?? 0} failed`);
  } catch (err) {
    info(`[API] Manual sync error: ${err}`);
  }
});

/** POST /api/orders/cleanup — Delete all synced orders from Shopify and clear local DB */
router.post('/api/orders/cleanup', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const dryRun = req.query.dry === 'true';

    // Get Shopify access token
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'No Shopify token found. Complete OAuth first.' });
      return;
    }

    // Get all synced order IDs
    const orders = db.prepare(`SELECT id, shopify_order_id, shopify_order_name FROM order_mappings ORDER BY id`).all() as any[];
    
    if (dryRun) {
      res.json({ dryRun: true, count: orders.length, orders: orders.map(o => o.shopify_order_name) });
      return;
    }

    const results: { id: string; name: string; status: string; error?: string }[] = [];
    let deleted = 0;
    let failed = 0;

    for (const order of orders) {
      try {
        // First cancel the order (required before delete)
        await fetch(`https://usedcameragear.myshopify.com/admin/api/2024-01/orders/${order.shopify_order_id}/cancel.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': tokenRow.access_token,
            'Content-Type': 'application/json',
          },
        });

        // Then delete it
        const delRes = await fetch(`https://usedcameragear.myshopify.com/admin/api/2024-01/orders/${order.shopify_order_id}.json`, {
          method: 'DELETE',
          headers: { 'X-Shopify-Access-Token': tokenRow.access_token },
        });

        if (delRes.ok || delRes.status === 404) {
          deleted++;
          results.push({ id: order.shopify_order_id, name: order.shopify_order_name, status: 'deleted' });
        } else {
          const errText = await delRes.text();
          failed++;
          results.push({ id: order.shopify_order_id, name: order.shopify_order_name, status: 'failed', error: errText });
        }

        // Rate limit: Shopify allows 2 req/sec
        await new Promise(r => setTimeout(r, 600));
      } catch (err) {
        failed++;
        results.push({ id: order.shopify_order_id, name: order.shopify_order_name, status: 'error', error: String(err) });
      }
    }

    // Clear local order mappings and sync log
    db.prepare(`DELETE FROM order_mappings`).run();
    db.prepare(`DELETE FROM sync_log`).run();
    info(`[API] Cleanup complete: ${deleted} deleted, ${failed} failed out of ${orders.length}`);

    res.json({ ok: true, total: orders.length, deleted, failed, results: results.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ error: 'Cleanup failed', detail: String(err) });
  }
});

export default router;
