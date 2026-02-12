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

/** POST /api/sync/prices — Sync Shopify prices to eBay */
router.post('/api/sync/prices', async (req: Request, res: Response) => {
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
    
    info(`[API] Price sync triggered${dryRun ? ' (DRY RUN)' : ''}`);
    res.json({ ok: true, message: 'Price sync triggered', dryRun });
    
    // Run sync in background
    try {
      const { syncPrices } = await import('../../sync/price-sync.js');
      const result = await syncPrices(
        ebayRow.access_token,
        shopifyRow.access_token,
        { dryRun }
      );
      info(`[API] Price sync complete: ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed`);
    } catch (err) {
      info(`[API] Price sync error: ${err}`);
    }
    
  } catch (err) {
    res.status(500).json({ error: 'Price sync failed', detail: String(err) });
  }
});

/** POST /api/sync/inventory/:sku — Sync specific SKU inventory from Shopify to eBay */
router.post('/api/sync/inventory/:sku', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const sku = Array.isArray(req.params.sku) ? req.params.sku[0] : req.params.sku;
    const quantity = req.body.quantity as number;
    
    if (quantity === undefined || quantity === null) {
      res.status(400).json({ error: 'quantity required in request body' });
      return;
    }
    
    // Get eBay token
    const ebayRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'ebay'`).get() as any;
    if (!ebayRow?.access_token) {
      res.status(400).json({ error: 'eBay token not found.' });
      return;
    }
    
    info(`[API] Single inventory sync: ${sku} → ${quantity}`);
    
    const { updateEbayInventory } = await import('../../sync/inventory-sync.js');
    const result = await updateEbayInventory(ebayRow.access_token, sku, quantity);
    
    res.json({ ok: result.success, sku, quantity, action: result.action, error: result.error });
    
  } catch (err) {
    res.status(500).json({ error: 'Inventory sync failed', detail: String(err) });
  }
});

/** POST /api/test/update-price — Update test product price in Shopify */
router.post('/api/test/update-price', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'No Shopify token' });
      return;
    }

    const productId = req.body.productId as string;
    const variantId = req.body.variantId as string;
    const price = req.body.price as string;
    
    if (!productId || !variantId || !price) {
      res.status(400).json({ error: 'productId, variantId, and price required' });
      return;
    }

    const response = await fetch(`https://usedcameragear.myshopify.com/admin/api/2024-01/variants/${variantId}.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': tokenRow.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ variant: { id: variantId, price } }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(500).json({ error: 'Failed to update price', detail: errText });
      return;
    }

    const data = await response.json() as any;
    info(`[API] Test product price updated: variant ${variantId} → $${price}`);
    res.json({ ok: true, variant: data.variant });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: String(err) });
  }
});

/** POST /api/test/update-inventory — Update test product inventory in Shopify */
router.post('/api/test/update-inventory', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'No Shopify token' });
      return;
    }

    const inventoryItemId = req.body.inventoryItemId as string;
    const locationId = req.body.locationId as string;
    const quantity = req.body.quantity as number;
    
    if (!inventoryItemId || !locationId || quantity === undefined) {
      res.status(400).json({ error: 'inventoryItemId, locationId, and quantity required' });
      return;
    }

    // Shopify requires "set" operation with inventory_levels/set
    const response = await fetch('https://usedcameragear.myshopify.com/admin/api/2024-01/inventory_levels/set.json', {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': tokenRow.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        location_id: locationId,
        inventory_item_id: inventoryItemId,
        available: quantity,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(500).json({ error: 'Failed to update inventory', detail: errText });
      return;
    }

    const data = await response.json() as any;
    info(`[API] Test product inventory updated: item ${inventoryItemId} → ${quantity}`);
    res.json({ ok: true, inventoryLevel: data.inventory_level });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: String(err) });
  }
});

/** GET /api/test/product-info/:productId — Get full Shopify product details for testing */
router.get('/api/test/product-info/:productId', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'No Shopify token' });
      return;
    }

    const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
    const response = await fetch(`https://usedcameragear.myshopify.com/admin/api/2024-01/products/${productId}.json`, {
      headers: { 'X-Shopify-Access-Token': tokenRow.access_token },
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(500).json({ error: 'Failed to fetch product', detail: errText });
      return;
    }

    const data = await response.json() as any;
    const product = data.product;
    const variant = product.variants?.[0];
    
    res.json({ 
      ok: true, 
      product: {
        id: product.id,
        title: product.title,
        status: product.status,
        variant: variant ? {
          id: variant.id,
          sku: variant.sku,
          price: variant.price,
          inventory_item_id: variant.inventory_item_id,
          inventory_quantity: variant.inventory_quantity,
        } : null,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: String(err) });
  }
});

/** GET /api/test/ebay-offer/:sku — Get eBay offer details for a SKU */
router.get('/api/test/ebay-offer/:sku', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const ebayRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'ebay'`).get() as any;
    if (!ebayRow?.access_token) {
      res.status(400).json({ error: 'No eBay token' });
      return;
    }

    const sku = Array.isArray(req.params.sku) ? req.params.sku[0] : req.params.sku;
    
    const { getOffersBySku, getInventoryItem } = await import('../../ebay/inventory.js');
    
    const [offers, inventoryItem] = await Promise.all([
      getOffersBySku(ebayRow.access_token, sku),
      getInventoryItem(ebayRow.access_token, sku),
    ]);
    
    const offer = offers.offers?.[0];
    
    res.json({ 
      ok: true, 
      sku,
      inventoryItem: inventoryItem ? {
        quantity: inventoryItem.availability?.shipToLocationAvailability?.quantity,
        condition: inventoryItem.condition,
        title: inventoryItem.product?.title,
      } : null,
      offer: offer ? {
        offerId: offer.offerId,
        status: (offer as any).status,
        listingId: (offer as any).listingId,
        price: offer.pricingSummary?.price?.value,
        quantity: offer.availableQuantity,
        format: offer.format,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: String(err) });
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

/** GET /api/mappings — List all mappings grouped by category */
router.get('/api/mappings', async (_req: Request, res: Response) => {
  try {
    const { getAllMappings } = await import('../../sync/attribute-mapping-service.js');
    const mappings = await getAllMappings();
    res.json(mappings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch mappings', detail: String(err) });
  }
});

/** GET /api/mappings/:category — List mappings for a category (sales/listing/payment/shipping) */
router.get('/api/mappings/:category', async (req: Request, res: Response) => {
  try {
    const category = Array.isArray(req.params.category) ? req.params.category[0] : req.params.category;
    const { getMappingsByCategory } = await import('../../sync/attribute-mapping-service.js');
    const mappings = await getMappingsByCategory(category);
    res.json({ data: mappings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch mappings', detail: String(err) });
  }
});

/** PUT /api/mappings/:category/:field_name — Update a single mapping */
router.put('/api/mappings/:category/:field_name', async (req: Request, res: Response) => {
  try {
    const category = Array.isArray(req.params.category) ? req.params.category[0] : req.params.category;
    const fieldName = Array.isArray(req.params.field_name) ? req.params.field_name[0] : req.params.field_name;
    const { mapping_type, source_value, target_value, variation_mapping, is_enabled } = req.body;
    
    const { updateMapping } = await import('../../sync/attribute-mapping-service.js');
    const mapping = await updateMapping(category, fieldName, {
      mapping_type,
      source_value,
      target_value,
      variation_mapping,
      is_enabled: is_enabled !== undefined ? Boolean(is_enabled) : undefined,
    });
    
    if (!mapping) {
      res.status(404).json({ error: 'Mapping not found or no changes made' });
      return;
    }
    
    info(`[API] Updated mapping ${category}.${fieldName}: ${JSON.stringify(req.body)}`);
    res.json(mapping);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update mapping', detail: String(err) });
  }
});

/** POST /api/mappings/bulk — Update multiple mappings at once */
router.post('/api/mappings/bulk', async (req: Request, res: Response) => {
  try {
    const { mappings } = req.body;
    
    if (!Array.isArray(mappings)) {
      res.status(400).json({ error: 'mappings array is required' });
      return;
    }
    
    const { updateMappingsBulk } = await import('../../sync/attribute-mapping-service.js');
    const result = await updateMappingsBulk(mappings);
    
    info(`[API] Bulk update complete: ${result.updated} updated, ${result.failed} failed`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to bulk update mappings', detail: String(err) });
  }
});

/** GET /api/mappings/export — Export all mappings as JSON (for backup) */
router.get('/api/mappings/export', async (_req: Request, res: Response) => {
  try {
    const { exportMappings } = await import('../../sync/attribute-mapping-service.js');
    const mappings = await exportMappings();
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=attribute-mappings.json');
    res.json(mappings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export mappings', detail: String(err) });
  }
});

/** POST /api/mappings/import — Import mappings from JSON */
router.post('/api/mappings/import', async (req: Request, res: Response) => {
  try {
    const { mappings } = req.body;
    
    if (!Array.isArray(mappings)) {
      res.status(400).json({ error: 'mappings array is required' });
      return;
    }
    
    const { importMappings } = await import('../../sync/attribute-mapping-service.js');
    const result = await importMappings(mappings);
    
    info(`[API] Import complete: ${result.imported} imported, ${result.updated} updated`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to import mappings', detail: String(err) });
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

/** POST /api/test/create-product — Create a test product in Shopify for sync testing */
router.post('/api/test/create-product', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'No Shopify token' });
      return;
    }

    const title = (req.body.title as string) || 'Camera Cleaning Kit - Basic';
    const price = (req.body.price as string) || '19.99';
    const inventory = parseInt(req.body.inventory as string) || 3;

    const product = {
      product: {
        title,
        body_html: `<p>Basic camera cleaning kit. Includes lens cloth, blower, and brush.</p>`,
        vendor: 'Pictureline',
        product_type: 'Accessories',
        tags: 'test,ebay-sync-test,Used',
        variants: [{
          price,
          sku: `TEST-${Date.now()}`,
          inventory_management: 'shopify',
          inventory_quantity: inventory,
          barcode: '0000000000000',
        }],
        status: 'active',
      },
    };

    const response = await fetch('https://usedcameragear.myshopify.com/admin/api/2024-01/products.json', {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': tokenRow.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(product),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(500).json({ error: 'Failed to create product', detail: errText });
      return;
    }

    const data = await response.json() as any;
    info(`[API] Test product created: ${data.product.id} — ${data.product.title}`);
    res.json({ ok: true, product: { id: data.product.id, title: data.product.title, variants: data.product.variants } });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: String(err) });
  }
});

/** POST /api/test/add-image — Add an image to an existing Shopify product */
router.post('/api/test/add-image', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'No Shopify token' });
      return;
    }

    const productId = req.body.productId as string;
    const imageUrl = req.body.imageUrl as string;
    if (!productId || !imageUrl) {
      res.status(400).json({ error: 'productId and imageUrl required' });
      return;
    }

    const response = await fetch(`https://usedcameragear.myshopify.com/admin/api/2024-01/products/${productId}/images.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': tokenRow.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: { src: imageUrl } }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(500).json({ error: 'Failed to add image', detail: errText });
      return;
    }

    const data = await response.json() as any;
    info(`[API] Image added to product ${productId}: ${data.image?.id}`);
    res.json({ ok: true, image: data.image });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: String(err) });
  }
});

export default router;
