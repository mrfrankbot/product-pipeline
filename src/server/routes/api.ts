import { Router, type Request, type Response } from 'express';
import { getRawDb } from '../../db/client.js';
import { getValidEbayToken } from '../../ebay/token-manager.js';
import { info } from '../../utils/logger.js';
import { fetchAllShopifyProductsOverview, fetchDetailedShopifyProduct } from '../../shopify/products.js';

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

    // Check auth token status
    const shopifyToken = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    const ebayToken = db.prepare(`SELECT access_token, expires_at FROM auth_tokens WHERE platform = 'ebay'`).get() as any;

    res.json({
      status: 'running',
      products: { mapped: productCount?.count ?? 0 },
      orders: { imported: orderCount?.count ?? 0 },
      shopifyConnected: !!shopifyToken?.access_token,
      ebayConnected: !!ebayToken?.access_token,
      lastSyncs,
      recentNotifications,
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status', detail: String(err) });
  }
});

/** GET /api/listings — Paginated product listings with eBay status, filtering & search */
router.get('/api/listings', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string || '').trim();
    const statusParam = (req.query.status as string || '').trim();

    const conditions: string[] = [];
    const params: any[] = [];

    // Status filter: accept comma-separated values → WHERE status IN (...)
    if (statusParam) {
      const statuses = statusParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (statuses.length > 0) {
        conditions.push(`status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
    }

    // Search filter: match against title, SKU, shopify product ID, or eBay listing ID
    if (search) {
      conditions.push(
        `(shopify_title LIKE ? OR shopify_sku LIKE ? OR shopify_product_id LIKE ? OR ebay_listing_id LIKE ?)`
      );
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM product_mappings ${whereClause}`).get(...params) as any;
    const listings = db.prepare(
      `SELECT * FROM product_mappings ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({ data: listings, total: countRow?.count ?? 0, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch listings', detail: String(err) });
  }
});

/** GET /api/products/overview — Unified Shopify + pipeline + eBay status */
router.get('/api/products/overview', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'Shopify token not found. Complete OAuth first.' });
      return;
    }

    const productId = (req.query.productId as string | undefined)?.trim();
    let shopifyProducts: Array<{
      id: string;
      title: string;
      status: string;
      images: Array<{ id: string; src: string; alt?: string }>;
      variants: Array<{ id: string; sku: string; price: string }>;
    }> = [];

    if (productId) {
      const detailed = await fetchDetailedShopifyProduct(tokenRow.access_token, productId);
      if (!detailed) {
        res.status(404).json({ error: 'Product not found in Shopify' });
        return;
      }
      shopifyProducts = [
        {
          id: detailed.id,
          title: detailed.title,
          status: detailed.status,
          images: detailed.images.map((img) => ({ id: img.id, src: img.url, alt: img.altText })),
          variants: detailed.variants.map((variant) => ({
            id: variant.id,
            sku: variant.sku,
            price: variant.price,
          })),
        },
      ];
    } else {
      shopifyProducts = await fetchAllShopifyProductsOverview(tokenRow.access_token);
    }

    const mappingRows = productId
      ? db.prepare(`SELECT shopify_product_id, ebay_listing_id, status FROM product_mappings WHERE shopify_product_id = ?`).all(productId)
      : db.prepare(`SELECT shopify_product_id, ebay_listing_id, status FROM product_mappings`).all();
    const pipelineRows = productId
      ? db.prepare(`SELECT * FROM product_pipeline_status WHERE shopify_product_id = ?`).all(productId)
      : db.prepare(`SELECT * FROM product_pipeline_status`).all();
    const pipelineJobRows = productId
      ? db.prepare(`SELECT id, shopify_product_id, updated_at FROM pipeline_jobs WHERE shopify_product_id = ?`).all(productId)
      : db.prepare(`SELECT id, shopify_product_id, updated_at FROM pipeline_jobs`).all();

    const mappingById = new Map<string, any>();
    for (const row of mappingRows as any[]) {
      mappingById.set(String(row.shopify_product_id), row);
    }
    const pipelineById = new Map<string, any>();
    for (const row of pipelineRows as any[]) {
      pipelineById.set(String(row.shopify_product_id), row);
    }
    const latestJobById = new Map<string, { id: string; updated_at: number }>();
    for (const row of pipelineJobRows as any[]) {
      const key = String(row.shopify_product_id);
      const prev = latestJobById.get(key);
      if (!prev || (row.updated_at ?? 0) > prev.updated_at) {
        latestJobById.set(key, { id: row.id, updated_at: row.updated_at ?? 0 });
      }
    }

    const products = shopifyProducts.map((product) => {
      const variant = product.variants?.[0];
      const mapping = mappingById.get(product.id);
      const pipeline = pipelineById.get(product.id);
      const ebayListingId = mapping?.ebay_listing_id ?? null;
      const ebayStatus = ebayListingId
        ? ebayListingId.startsWith('draft-')
          ? 'draft'
          : 'listed'
        : 'not_listed';

      return {
        shopifyProductId: product.id,
        title: product.title,
        sku: variant?.sku ?? '',
        price: variant?.price ?? '',
        shopifyStatus: product.status,
        imageUrl: product.images?.[0]?.src ?? null,
        imageCount: product.images?.length ?? 0,
        hasAiDescription: Boolean(pipeline?.ai_description_generated),
        hasProcessedImages: Boolean(pipeline?.images_processed),
        ebayStatus,
        ebayListingId,
        pipelineJobId: latestJobById.get(product.id)?.id ?? null,
      };
    });

    const summary = {
      total: products.length,
      withDescriptions: products.filter((p) => p.hasAiDescription).length,
      withProcessedImages: products.filter((p) => p.hasProcessedImages).length,
      listedOnEbay: products.filter((p) => p.ebayStatus === 'listed').length,
      draftOnEbay: products.filter((p) => p.ebayStatus === 'draft').length,
    };

    res.json({ products, summary });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product overview', detail: String(err) });
  }
});

/** GET /api/products/:productId/pipeline-status — Single product pipeline status */
router.get('/api/products/:productId/pipeline-status', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
    const row = db
      .prepare(`SELECT * FROM product_pipeline_status WHERE shopify_product_id = ?`)
      .get(productId) as any;

    res.json({ ok: true, status: row ?? null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pipeline status', detail: String(err) });
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
    const result = Object.fromEntries(settings.map((s: any) => [s.key, s.value]));
    // Expose env-var-based config as read-only settings flags
    result.photoroom_api_key_configured = process.env.PHOTOROOM_API_KEY ? 'true' : 'false';
    result.openai_api_key_configured = process.env.OPENAI_API_KEY ? 'true' : 'false';
    res.json(result);
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
    const draft = req.body.draft === true || req.query.draft === 'true';
    const productIds = req.body.productIds as string[];
    
    if (!Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ error: 'productIds array required in request body' });
      return;
    }
    
    // Get tokens
    const ebayToken = await getValidEbayToken();
    const shopifyRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    
    if (!ebayToken) {
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
    
    info(`[API] Product sync triggered: ${productIds.length} products${dryRun ? ' (DRY RUN)' : ''}${draft ? ' (DRAFT)' : ''}`);
    res.json({ ok: true, message: 'Product sync triggered', productIds, dryRun, draft });
    
    // Run sync in background
    try {
      const { syncProducts } = await import('../../sync/product-sync.js');
      const result = await syncProducts(
        ebayToken,
        shopifyRow.access_token,
        productIds,
        settingsObj,
        { dryRun, draft }
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
    const ebayToken = await getValidEbayToken();
    const shopifyRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    
    if (!ebayToken) {
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
        ebayToken,
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
    const ebayToken = await getValidEbayToken();
    const shopifyRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    
    if (!ebayToken) {
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
        ebayToken,
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
    const ebayToken = await getValidEbayToken();
    if (!ebayToken) {
      res.status(400).json({ error: 'eBay token not found.' });
      return;
    }
    
    info(`[API] Single inventory sync: ${sku} → ${quantity}`);
    
    const { updateEbayInventory } = await import('../../sync/inventory-sync.js');
    const result = await updateEbayInventory(ebayToken, sku, quantity);
    
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
    const product = await fetchDetailedShopifyProduct(tokenRow.access_token, productId);
    if (!product) {
      res.status(404).json({ error: 'Product not found in Shopify' });
      return;
    }

    const variant = product.variants?.[0];
    const images = product.images.map((img) => ({ id: Number(img.id), src: img.url, alt: img.altText }));

    res.json({
      ok: true,
      product: {
        id: product.id,
        title: product.title,
        status: product.status,
        body_html: product.descriptionHtml,
        product_type: product.productType,
        vendor: product.vendor,
        tags: product.tags.join(', '),
        images,
        image: images[0] ?? null,
        variants: product.variants.map((v) => ({
          id: Number(v.id),
          sku: v.sku,
          price: v.price,
          compare_at_price: v.compareAtPrice ?? null,
          inventory_quantity: v.inventoryQuantity,
          weight: v.weight,
          weight_unit: v.weightUnit,
          requires_shipping: v.requiresShipping,
        })),
        variant: variant
          ? {
              id: Number(variant.id),
              sku: variant.sku,
              price: variant.price,
              compare_at_price: variant.compareAtPrice ?? null,
              inventory_quantity: variant.inventoryQuantity,
              weight: variant.weight,
              weight_unit: variant.weightUnit,
              requires_shipping: variant.requiresShipping,
            }
          : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: String(err) });
  }
});

/** GET /api/test/shopify-locations — Get Shopify locations */
router.get('/api/test/shopify-locations', async (_req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'No Shopify token' });
      return;
    }

    const response = await fetch('https://usedcameragear.myshopify.com/admin/api/2024-01/locations.json', {
      headers: { 'X-Shopify-Access-Token': tokenRow.access_token },
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(500).json({ error: 'Failed to fetch locations', detail: errText });
      return;
    }

    const data = await response.json() as any;
    res.json({ ok: true, locations: data.locations?.map((l: any) => ({ id: l.id, name: l.name, active: l.active })) || [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: String(err) });
  }
});

/** GET /api/test/ebay-offer/:sku — Get eBay offer details for a SKU */
router.get('/api/test/ebay-offer/:sku', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const ebayToken = await getValidEbayToken();
    if (!ebayToken) {
      res.status(400).json({ error: 'No eBay token' });
      return;
    }

    const sku = Array.isArray(req.params.sku) ? req.params.sku[0] : req.params.sku;
    
    const { getOffersBySku, getInventoryItem } = await import('../../ebay/inventory.js');
    
    const [offers, inventoryItem] = await Promise.all([
      getOffersBySku(ebayToken, sku),
      getInventoryItem(ebayToken, sku),
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

/** PUT /api/sync/products/:productId — Update existing eBay listing from Shopify */
router.put('/api/sync/products/:productId', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
    
    const ebayToken = await getValidEbayToken();
    const shopifyRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    
    if (!ebayToken || !shopifyRow?.access_token) {
      res.status(400).json({ error: 'Missing eBay or Shopify token' });
      return;
    }
    
    const settings = db.prepare(`SELECT * FROM settings`).all() as any[];
    const settingsObj = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    
    const { updateProductOnEbay } = await import('../../sync/product-sync.js');
    const result = await updateProductOnEbay(ebayToken, shopifyRow.access_token, productId, settingsObj);
    
    res.json({ ok: result.success, productId, updated: result.updated, error: result.error });
  } catch (err) {
    res.status(500).json({ error: 'Product update failed', detail: String(err) });
  }
});

/** POST /api/sync/products/:productId/end — End an eBay listing (product archived/deleted) */
router.post('/api/sync/products/:productId/end', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
    
    const ebayToken = await getValidEbayToken();
    if (!ebayToken) {
      res.status(400).json({ error: 'No eBay token' });
      return;
    }
    
    const { endEbayListing } = await import('../../sync/product-sync.js');
    const result = await endEbayListing(ebayToken, productId);
    
    res.json({ ok: result.success, productId, error: result.error });
  } catch (err) {
    res.status(500).json({ error: 'Failed to end listing', detail: String(err) });
  }
});

/** POST /api/test/update-product — Update test product title/status in Shopify */
router.post('/api/test/update-product', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'No Shopify token' });
      return;
    }

    const productId = req.body.productId as string;
    const updates: any = {};
    if (req.body.title) updates.title = req.body.title;
    if (req.body.status) updates.status = req.body.status;
    if (req.body.body_html) updates.body_html = req.body.body_html;

    if (!productId || Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'productId and at least one field (title, status, body_html) required' });
      return;
    }

    const response = await fetch(`https://usedcameragear.myshopify.com/admin/api/2024-01/products/${productId}.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': tokenRow.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ product: { id: productId, ...updates } }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(500).json({ error: 'Failed to update product', detail: errText });
      return;
    }

    const data = await response.json() as any;
    info(`[API] Test product updated: ${productId} — ${JSON.stringify(updates)}`);
    res.json({ ok: true, product: { id: data.product.id, title: data.product.title, status: data.product.status } });
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

/** GET /api/product-overrides/:shopifyProductId — Get per-product overrides */
router.get('/api/product-overrides/:shopifyProductId', async (req: Request, res: Response) => {
  try {
    const { shopifyProductId } = req.params;
    const { getProductOverrides } = await import('../../sync/attribute-mapping-service.js');
    const overrides = await getProductOverrides(shopifyProductId as string);
    res.json({ data: overrides });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product overrides', detail: String(err) });
  }
});

/** PUT /api/product-overrides/:shopifyProductId — Save per-product overrides */
router.put('/api/product-overrides/:shopifyProductId', async (req: Request, res: Response) => {
  try {
    const { shopifyProductId } = req.params;
    const { overrides } = req.body;

    if (!Array.isArray(overrides)) {
      res.status(400).json({ error: 'overrides array is required' });
      return;
    }

    const { saveProductOverridesBulk } = await import('../../sync/attribute-mapping-service.js');
    const count = await saveProductOverridesBulk(shopifyProductId as string, overrides);
    res.json({ ok: true, saved: count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save product overrides', detail: String(err) });
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
    const sku = (req.body.sku as string) || `TEST-${Date.now()}`;
    const bodyHtml = (req.body.body_html as string) || `<p>Basic camera cleaning kit. Includes lens cloth, blower, and brush.</p>`;
    const vendor = (req.body.vendor as string) || 'Pictureline';
    const productType = (req.body.product_type as string) || 'Accessories';
    const tags = (req.body.tags as string) || 'test,ebay-sync-test,Used';
    const images = (req.body.images as Array<{ src: string }>) || [];

    const product = {
      product: {
        title,
        body_html: bodyHtml,
        vendor,
        product_type: productType,
        tags,
        variants: [{
          price,
          sku,
          inventory_management: 'shopify',
          inventory_quantity: inventory,
          barcode: '0000000000000',
        }],
        images: images.length > 0 ? images : undefined,
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
    const attachment = req.body.attachment as string; // base64 encoded image
    const filename = req.body.filename as string;
    if (!productId || (!imageUrl && !attachment)) {
      res.status(400).json({ error: 'productId and (imageUrl or attachment) required' });
      return;
    }

    const imagePayload: Record<string, string> = {};
    if (attachment) {
      imagePayload.attachment = attachment;
      if (filename) imagePayload.filename = filename;
    } else {
      imagePayload.src = imageUrl;
    }

    const response = await fetch(`https://usedcameragear.myshopify.com/admin/api/2024-01/products/${productId}/images.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': tokenRow.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: imagePayload }),
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

/** DELETE /api/test/delete-product — Delete a product from Shopify + local DB */
router.delete('/api/test/delete-product', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) { res.status(400).json({ error: 'No Shopify token' }); return; }

    const productId = (req.query.productId || req.body?.productId) as string;
    if (!productId) { res.status(400).json({ error: 'productId required' }); return; }

    // Delete from Shopify (ignore 404 — may already be gone)
    const response = await fetch(
      `https://usedcameragear.myshopify.com/admin/api/2024-01/products/${productId}.json`,
      { method: 'DELETE', headers: { 'X-Shopify-Access-Token': tokenRow.access_token } },
    );

    const shopifyDeleted = response.ok || response.status === 404;
    if (!shopifyDeleted) {
      const errText = await response.text();
      res.status(500).json({ error: 'Failed to delete from Shopify', detail: errText });
      return;
    }

    // Clean up local DB records
    db.prepare(`DELETE FROM product_mappings WHERE shopify_product_id = ?`).run(productId);
    db.prepare(`DELETE FROM product_mapping_overrides WHERE shopify_product_id = ?`).run(productId);
    db.prepare(`DELETE FROM sync_log WHERE entity_id = ?`).run(productId);

    info(`[API] Product ${productId} deleted from Shopify + local DB`);
    res.json({ ok: true, deleted: productId });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: String(err) });
  }
});

/** DELETE /api/test/delete-image — Delete an image from a Shopify product */
router.delete('/api/test/delete-image', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) { res.status(400).json({ error: 'No Shopify token' }); return; }

    const productId = (req.query.productId || req.body?.productId) as string;
    const imageId = (req.query.imageId || req.body?.imageId) as string;
    if (!productId || !imageId) { res.status(400).json({ error: 'productId and imageId required' }); return; }

    const response = await fetch(
      `https://usedcameragear.myshopify.com/admin/api/2024-01/products/${productId}/images/${imageId}.json`,
      { method: 'DELETE', headers: { 'X-Shopify-Access-Token': tokenRow.access_token } },
    );

    if (!response.ok) {
      const errText = await response.text();
      res.status(500).json({ error: 'Failed to delete image', detail: errText });
      return;
    }

    info(`[API] Image ${imageId} deleted from product ${productId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: String(err) });
  }
});

// ---------------------------------------------------------------------------
// AI Listing Management Endpoints
// ---------------------------------------------------------------------------

/** POST /api/listings/republish-stale — Republish listings older than N days */
router.post('/api/listings/republish-stale', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const maxAgeDays = parseInt(req.body.maxAgeDays as string) || 30;

    const ebayToken = await getValidEbayToken();
    if (!ebayToken) {
      res.status(400).json({ error: 'eBay token not found. Complete OAuth first.' });
      return;
    }

    info(`[API] Republish stale listings triggered (maxAge: ${maxAgeDays} days)`);
    res.json({ ok: true, message: `Republishing listings older than ${maxAgeDays} days`, maxAgeDays });

    // Run in background
    try {
      const { republishStaleListings } = await import('../../sync/listing-manager.js');
      const result = await republishStaleListings(ebayToken, maxAgeDays);
      info(`[API] Republish complete: ${result.republished} republished, ${result.skipped} skipped, ${result.failed} failed`);
    } catch (err) {
      info(`[API] Republish error: ${err}`);
    }
  } catch (err) {
    res.status(500).json({ error: 'Republish failed', detail: String(err) });
  }
});

/** POST /api/listings/apply-price-drops — Apply price drops to eligible listings */
router.post('/api/listings/apply-price-drops', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();

    const ebayToken = await getValidEbayToken();
    if (!ebayToken) {
      res.status(400).json({ error: 'eBay token not found. Complete OAuth first.' });
      return;
    }

    info(`[API] Price drop schedule triggered`);
    res.json({ ok: true, message: 'Applying price drops to eligible listings' });

    // Run in background
    try {
      const { applyPriceDropSchedule } = await import('../../sync/listing-manager.js');
      const result = await applyPriceDropSchedule(ebayToken);
      info(`[API] Price drops complete: ${result.dropped} dropped, ${result.skipped} skipped, ${result.failed} failed`);
    } catch (err) {
      info(`[API] Price drop error: ${err}`);
    }
  } catch (err) {
    res.status(500).json({ error: 'Price drop failed', detail: String(err) });
  }
});

/** GET /api/listings/stale — Get listings eligible for action (older than N days) */
router.get('/api/listings/stale', async (req: Request, res: Response) => {
  try {
    const maxAgeDays = parseInt(req.query.days as string) || 14;

    const { getStaleListings } = await import('../../sync/listing-manager.js');
    const listings = await getStaleListings(maxAgeDays);

    res.json({ data: listings, total: listings.length, maxAgeDays });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stale listings', detail: String(err) });
  }
});

/** GET /api/listings/health — Listing health dashboard data */
router.get('/api/listings/health', async (_req: Request, res: Response) => {
  try {
    const { getListingHealth } = await import('../../sync/listing-manager.js');
    const health = await getListingHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch listing health', detail: String(err) });
  }
});

/** POST /api/listings/promote — Enable Promoted Listings for given listing IDs */
router.post('/api/listings/promote', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const { listingIds, adRate } = req.body;

    if (!Array.isArray(listingIds) || listingIds.length === 0) {
      res.status(400).json({ error: 'listingIds array required in request body' });
      return;
    }

    const ebayToken = await getValidEbayToken();
    if (!ebayToken) {
      res.status(400).json({ error: 'eBay token not found. Complete OAuth first.' });
      return;
    }

    const effectiveRate = parseFloat(adRate) || 2.0;
    info(`[API] Promoted Listings triggered for ${listingIds.length} listings at ${effectiveRate}%`);
    res.json({ ok: true, message: `Promoting ${listingIds.length} listings at ${effectiveRate}% ad rate`, listingIds, adRate: effectiveRate });

    // Run in background
    try {
      const { enablePromotedListings } = await import('../../sync/listing-manager.js');
      const result = await enablePromotedListings(ebayToken, listingIds, effectiveRate);
      info(`[API] Promote complete: ${result.promoted} promoted, ${result.failed} failed`);
    } catch (err) {
      info(`[API] Promote error: ${err}`);
    }
  } catch (err) {
    res.status(500).json({ error: 'Promote failed', detail: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Image Processing (PhotoRoom) Endpoints
// ---------------------------------------------------------------------------

/** GET /api/images/status — Check if PhotoRoom integration is configured */
router.get('/api/images/status', (_req: Request, res: Response) => {
  const apiKey = process.env.PHOTOROOM_API_KEY;
  res.json({
    configured: Boolean(apiKey),
    apiKey: Boolean(apiKey),
  });
});

/** POST /api/images/process/:shopifyProductId — Process product images through PhotoRoom */
router.post('/api/images/process/:shopifyProductId', async (req: Request, res: Response) => {
  try {
    const shopifyProductId = Array.isArray(req.params.shopifyProductId)
      ? req.params.shopifyProductId[0]
      : req.params.shopifyProductId;

    // Get Shopify token
    const db = await getRawDb();
    const tokenRow = db.prepare(
      `SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`,
    ).get() as any;

    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'No Shopify token. Complete OAuth first.' });
      return;
    }

    // Fetch the product from Shopify
    const productRes = await fetch(
      `https://usedcameragear.myshopify.com/admin/api/2024-01/products/${shopifyProductId}.json`,
      { headers: { 'X-Shopify-Access-Token': tokenRow.access_token } },
    );

    if (!productRes.ok) {
      const errText = await productRes.text();
      res.status(500).json({ error: 'Failed to fetch product from Shopify', detail: errText });
      return;
    }

    const productData = (await productRes.json()) as any;
    const product = productData.product;

    if (!product?.images || product.images.length === 0) {
      res.status(400).json({ error: 'Product has no images to process' });
      return;
    }

    info(`[API] Image processing triggered for product ${shopifyProductId} (${product.images.length} images)`);

    // Process images through PhotoRoom
    const { processProductImages } = await import('../../services/image-processor.js');
    const processedUrls = await processProductImages(product);

    res.json({
      ok: true,
      productId: shopifyProductId,
      originalCount: product.images.length,
      processedCount: processedUrls.length,
      images: processedUrls,
    });
  } catch (err) {
    res.status(500).json({ error: 'Image processing failed', detail: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Auto-Listing Pipeline Endpoints
// ---------------------------------------------------------------------------

/** POST /api/auto-list/batch — AI-generate descriptions + categories for multiple products */
router.post('/api/auto-list/batch', async (req: Request, res: Response) => {
  try {
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ error: 'productIds array required in request body' });
      return;
    }

    info(`[API] Auto-list batch triggered for ${productIds.length} products`);

    const { autoListProduct } = await import('../../sync/auto-listing-pipeline.js');
    const results: Array<{ productId: string; success: boolean; description?: string; categoryId?: string; error?: string }> = [];

    for (const productId of productIds) {
      const result = await autoListProduct(String(productId));
      results.push({ productId: String(productId), ...result });
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    info(`[API] Auto-list batch complete: ${succeeded} succeeded, ${failed} failed`);

    res.json({ ok: true, total: results.length, succeeded, failed, results });
  } catch (err) {
    res.status(500).json({ error: 'Auto-list batch failed', detail: String(err) });
  }
});

/** POST /api/auto-list/:shopifyProductId — AI-generate description + category for a product */
router.post('/api/auto-list/:shopifyProductId', async (req: Request, res: Response) => {
  try {
    const shopifyProductId = Array.isArray(req.params.shopifyProductId)
      ? req.params.shopifyProductId[0]
      : req.params.shopifyProductId;

    info(`[API] Auto-list triggered for product ${shopifyProductId}`);

    const { autoListProduct } = await import('../../sync/auto-listing-pipeline.js');
    const result = await autoListProduct(shopifyProductId);

    res.json({ ok: result.success, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Auto-list failed', detail: String(err) });
  }
});

/** POST /api/admin/backfill-shopify-metadata — Backfill shopify_title/price/sku for existing products */
router.post('/api/admin/backfill-shopify-metadata', async (_req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const tokenRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!tokenRow?.access_token) {
      res.status(400).json({ error: 'No Shopify token' });
      return;
    }

    const rows = db.prepare(`SELECT id, shopify_product_id FROM product_mappings WHERE shopify_title IS NULL`).all() as any[];
    let updated = 0;

    for (const row of rows) {
      try {
        const response = await fetch(
          `https://usedcameragear.myshopify.com/admin/api/2024-01/products/${row.shopify_product_id}.json`,
          { headers: { 'X-Shopify-Access-Token': tokenRow.access_token } }
        );
        if (response.ok) {
          const data = await response.json() as any;
          const product = data.product;
          const variant = product.variants?.[0];
          db.prepare(
            `UPDATE product_mappings SET shopify_title = ?, shopify_price = ?, shopify_sku = ?, updated_at = ? WHERE id = ?`
          ).run(
            product.title || null,
            variant?.price ? parseFloat(variant.price) : null,
            variant?.sku || null,
            Math.floor(Date.now() / 1000),
            row.id
          );
          updated++;
        }
      } catch { /* skip individual product errors */ }
    }

    info(`[Admin] Backfilled Shopify metadata for ${updated}/${rows.length} products`);
    res.json({ ok: true, updated, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Backfill failed', detail: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Product Notes
// ---------------------------------------------------------------------------

/** GET /api/products/:productId/notes — get notes for a product */
router.get('/api/products/:productId/notes', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const db = await getRawDb();
    const row = db
      .prepare(`SELECT product_notes FROM product_mappings WHERE shopify_product_id = ?`)
      .get(productId) as { product_notes: string } | undefined;
    res.json({ ok: true, notes: row?.product_notes ?? '' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get product notes', detail: String(err) });
  }
});

/** PUT /api/products/:productId/notes — save notes for a product */
router.put('/api/products/:productId/notes', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { notes } = req.body as { notes: string };
    const db = await getRawDb();

    // Check if row exists
    const existing = db
      .prepare(`SELECT id FROM product_mappings WHERE shopify_product_id = ?`)
      .get(productId) as { id: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE product_mappings SET product_notes = ?, updated_at = unixepoch() WHERE shopify_product_id = ?`,
      ).run(notes ?? '', productId);
    } else {
      db.prepare(
        `INSERT INTO product_mappings (shopify_product_id, ebay_listing_id, product_notes, created_at, updated_at) VALUES (?, '', ?, unixepoch(), unixepoch())`,
      ).run(productId, notes ?? '');
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save product notes', detail: String(err) });
  }
});

export default router;
