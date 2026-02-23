/**
 * Draft/Staging Review Queue API Routes
 *
 * Provides endpoints for reviewing, approving, rejecting, and managing
 * product drafts that go through the staging system.
 */

import { Router, type Request, type Response } from 'express';
import {
  getDraft,
  getDraftByProduct,
  listPendingDrafts,
  approveDraft,
  rejectDraft,
  updateDraft,
  getPendingDraftCount,
  getAllAutoPublishSettings,
  setAutoPublishSetting,
  updateGlobalAutoPublishSettings,
  checkExistingContent,
} from '../../services/draft-service.js';
import { info, error as logError } from '../../utils/logger.js';
import { getValidEbayToken } from '../../ebay/token-manager.js';
import { getRawDb } from '../../db/client.js';
import { fetchDetailedShopifyProduct } from '../../shopify/products.js';
import { loadShopifyCredentials } from '../../config/credentials.js';

const router = Router();

// ── GET /api/drafts — List drafts with pagination ─────────────────────

router.get('/api/drafts', async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || 'pending';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await listPendingDrafts({ status, limit, offset });

    res.json({
      data: result.data,
      total: result.total,
      limit,
      offset,
      pendingCount: await getPendingDraftCount(),
    });
  } catch (err) {
    logError(`[DraftsAPI] List error: ${err}`);
    res.status(500).json({ error: 'Failed to list drafts' });
  }
});

// ── GET /api/drafts/count — Get pending draft count (for badge) ───────

router.get('/api/drafts/count', async (_req: Request, res: Response) => {
  try {
    const count = await getPendingDraftCount();
    res.json({ count });
  } catch (err) {
    logError(`[DraftsAPI] Count error: ${err}`);
    res.status(500).json({ error: 'Failed to get draft count' });
  }
});

// ── GET /api/drafts/settings — Get auto-publish settings ──────────────

router.get('/api/drafts/settings', async (_req: Request, res: Response) => {
  try {
    const settings = await getAllAutoPublishSettings();
    res.json(settings);
  } catch (err) {
    logError(`[DraftsAPI] Settings read error: ${err}`);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// ── PUT /api/drafts/settings — Update auto-publish settings ───────────

router.put('/api/drafts/settings', async (req: Request, res: Response) => {
  try {
    const { perType, global } = req.body;

    // Update per-type settings
    if (Array.isArray(perType)) {
      for (const item of perType) {
        if (item.product_type && typeof item.enabled === 'boolean') {
          await setAutoPublishSetting(item.product_type, item.enabled);
        }
      }
    }

    // Update global settings
    if (global) {
      await updateGlobalAutoPublishSettings(global);
    }

    const updated = await getAllAutoPublishSettings();
    res.json(updated);
  } catch (err) {
    logError(`[DraftsAPI] Settings update error: ${err}`);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ── GET /api/drafts/product/:productId — Get pending draft for a product ───

router.get('/api/drafts/product/:productId', async (req: Request, res: Response) => {
  try {
    const productId = req.params.productId as string;
    if (!productId) {
      res.status(400).json({ error: 'Product ID required' });
      return;
    }

    const draft = await getDraftByProduct(productId);
    if (!draft) {
      res.json({ draft: null });
      return;
    }

    // Fetch current live Shopify data for comparison
    const liveContent = await checkExistingContent(draft.shopify_product_id);

    res.json({
      draft,
      live: {
        title: liveContent.title,
        description: liveContent.description,
        images: liveContent.images,
        hasPhotos: liveContent.hasPhotos,
        hasDescription: liveContent.hasDescription,
      },
    });
  } catch (err) {
    logError(`[DraftsAPI] Get draft by product error: ${err}`);
    res.status(500).json({ error: 'Failed to get draft for product' });
  }
});

// ── GET /api/drafts/:id — Get single draft with comparison data ───────

router.get('/api/drafts/:id', async (req: Request, res: Response) => {
  try {
    const draftId = parseInt(req.params.id as string);
    if (isNaN(draftId)) {
      res.status(400).json({ error: 'Invalid draft ID' });
      return;
    }

    const draft = await getDraft(draftId);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }

    // Fetch current live Shopify data for side-by-side comparison
    const liveContent = await checkExistingContent(draft.shopify_product_id);

    res.json({
      draft,
      live: {
        title: liveContent.title,
        description: liveContent.description,
        images: liveContent.images,
        hasPhotos: liveContent.hasPhotos,
        hasDescription: liveContent.hasDescription,
      },
    });
  } catch (err) {
    logError(`[DraftsAPI] Get draft error: ${err}`);
    res.status(500).json({ error: 'Failed to get draft' });
  }
});

// ── POST /api/drafts/:id/approve — Approve a draft ───────────────────

router.post('/api/drafts/:id/approve', async (req: Request, res: Response) => {
  try {
    const draftId = parseInt(req.params.id as string);
    if (isNaN(draftId)) {
      res.status(400).json({ error: 'Invalid draft ID' });
      return;
    }

    const { photos = true, description = true } = req.body || {};

    info(`[DraftsAPI] Approving draft ${draftId} — photos=${photos}, description=${description}`);
    const result = await approveDraft(draftId, { photos, description });

    if (result.success) {
      res.json({ success: true, message: 'Draft approved and pushed to Shopify' });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    logError(`[DraftsAPI] Approve error: ${err}`);
    res.status(500).json({ error: 'Failed to approve draft' });
  }
});

// ── POST /api/drafts/:id/reject — Reject a draft ─────────────────────

router.post('/api/drafts/:id/reject', async (req: Request, res: Response) => {
  try {
    const draftId = parseInt(req.params.id as string);
    if (isNaN(draftId)) {
      res.status(400).json({ error: 'Invalid draft ID' });
      return;
    }

    const result = await rejectDraft(draftId);

    if (result.success) {
      res.json({ success: true, message: 'Draft rejected' });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    logError(`[DraftsAPI] Reject error: ${err}`);
    res.status(500).json({ error: 'Failed to reject draft' });
  }
});

// ── PUT /api/drafts/:id — Edit a draft before approving ──────────────

router.put('/api/drafts/:id', async (req: Request, res: Response) => {
  try {
    const draftId = parseInt(req.params.id as string);
    if (isNaN(draftId)) {
      res.status(400).json({ error: 'Invalid draft ID' });
      return;
    }

    const { title, description, images } = req.body;

    const result = await updateDraft(draftId, { title, description, images });

    if (result.success) {
      const updated = await getDraft(draftId);
      res.json({ success: true, draft: updated });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    logError(`[DraftsAPI] Update error: ${err}`);
    res.status(500).json({ error: 'Failed to update draft' });
  }
});

// ── POST /api/drafts/approve-all — Bulk approve pending drafts ────────

router.post('/api/drafts/approve-all', async (req: Request, res: Response) => {
  try {
    const { photos = true, description = true, confirm = false } = req.body || {};

    if (!confirm) {
      // Return count for confirmation dialog
      const count = await getPendingDraftCount();
      res.json({
        requiresConfirmation: true,
        pendingCount: count,
        message: `This will approve ${count} pending drafts. Send { confirm: true } to proceed.`,
      });
      return;
    }

    const pending = await listPendingDrafts({ status: 'pending', limit: 200, offset: 0 });

    let approved = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const draft of pending.data) {
      const result = await approveDraft(draft.id, { photos, description });
      if (result.success) {
        approved++;
      } else {
        failed++;
        errors.push(`Draft #${draft.id}: ${result.error}`);
      }
    }

    info(`[DraftsAPI] Bulk approve: ${approved} approved, ${failed} failed`);
    res.json({
      success: true,
      approved,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    logError(`[DraftsAPI] Bulk approve error: ${err}`);
    res.status(500).json({ error: 'Failed to bulk approve drafts' });
  }
});

// ── POST /api/drafts/:id/preview-ebay-listing — Preview what would be created on eBay ───

router.post('/api/drafts/:id/preview-ebay-listing', async (req: Request, res: Response) => {
  try {
    const draftId = parseInt(req.params.id as string);
    if (isNaN(draftId)) {
      res.status(400).json({ error: 'Invalid draft ID' });
      return;
    }

    const draft = await getDraft(draftId);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }

    if (draft.status !== 'pending') {
      res.status(400).json({ error: `Draft is ${draft.status}, not pending` });
      return;
    }

    const db = await getRawDb();
    const shopifyRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!shopifyRow?.access_token) {
      res.status(400).json({ error: 'Shopify token not found' });
      return;
    }

    const ebayToken = await getValidEbayToken();
    if (!ebayToken) {
      res.status(400).json({ error: 'eBay token not found' });
      return;
    }

    // Get Shopify product details
    const shopifyProduct = await fetchDetailedShopifyProduct(shopifyRow.access_token, draft.shopify_product_id);
    if (!shopifyProduct) {
      res.status(404).json({ error: 'Shopify product not found' });
      return;
    }

    const variant = shopifyProduct.variants[0];
    if (!variant?.sku) {
      res.status(400).json({ error: 'Product has no SKU' });
      return;
    }

    // Get business policies
    const { getBusinessPolicies } = await import('../../ebay/inventory.js');
    const policies = await getBusinessPolicies(ebayToken);

    // Prepare preview data (what would be created)
    const preview = {
      sku: variant.sku,
      title: draft.draft_title || shopifyProduct.title,
      description: draft.draft_description || shopifyProduct.descriptionHtml || '',
      price: variant.price,
      quantity: Math.max(0, variant.inventoryQuantity || 0),
      images: draft.draftImages?.length > 0 ? draft.draftImages : 
               shopifyProduct.images.map(img => img.url),
      condition: 'USED_VERY_GOOD', // Default condition
      categoryId: '30', // Default camera category
      businessPolicies: policies,
      marketplaceId: 'EBAY_US',
      format: 'FIXED_PRICE'
    };

    info(`[DraftsAPI] Generated eBay listing preview for draft ${draftId}`);
    res.json({ 
      success: true, 
      preview,
      dryRun: true,
      message: 'This is a preview - no listing has been created'
    });
  } catch (err) {
    logError(`[DraftsAPI] Preview listing error: ${err}`);
    res.status(500).json({ error: 'Failed to preview eBay listing', detail: String(err) });
  }
});

// ── POST /api/drafts/:id/list-on-ebay — Create actual eBay listing ───────

router.post('/api/drafts/:id/list-on-ebay', async (req: Request, res: Response) => {
  try {
    const draftId = parseInt(req.params.id as string);
    if (isNaN(draftId)) {
      res.status(400).json({ error: 'Invalid draft ID' });
      return;
    }

    const draft = await getDraft(draftId);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }

    if (draft.status !== 'pending') {
      res.status(400).json({ error: `Draft is ${draft.status}, not pending. Only pending drafts can be listed.` });
      return;
    }

    const db = await getRawDb();
    const now = Math.floor(Date.now() / 1000);

    // Get tokens
    const shopifyRow = db.prepare(`SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`).get() as any;
    if (!shopifyRow?.access_token) {
      res.status(400).json({ error: 'Shopify token not found' });
      return;
    }

    const ebayToken = await getValidEbayToken();
    if (!ebayToken) {
      res.status(400).json({ error: 'eBay token not found' });
      return;
    }

    // Get Shopify product details
    const shopifyProduct = await fetchDetailedShopifyProduct(shopifyRow.access_token, draft.shopify_product_id);
    if (!shopifyProduct) {
      res.status(404).json({ error: 'Shopify product not found' });
      return;
    }

    const variant = shopifyProduct.variants[0];
    if (!variant?.sku) {
      res.status(400).json({ error: 'Product has no SKU - cannot create eBay listing' });
      return;
    }

    // Check if already listed on eBay
    const existingMapping = db.prepare(
      `SELECT ebay_listing_id FROM product_mappings WHERE shopify_product_id = ? AND ebay_listing_id != ''`
    ).get(draft.shopify_product_id) as { ebay_listing_id: string } | undefined;

    if (existingMapping) {
      res.status(400).json({ error: `Product already has eBay listing: ${existingMapping.ebay_listing_id}` });
      return;
    }

    info(`[DraftsAPI] Creating eBay listing for draft ${draftId}, SKU: ${variant.sku}`);

    // Import eBay functions
    const { 
      createOrReplaceInventoryItem, 
      createOffer, 
      publishOffer, 
      getBusinessPolicies 
    } = await import('../../ebay/inventory.js');

    // Get business policies
    const policies = await getBusinessPolicies(ebayToken);

    // Prepare inventory item data
    const inventoryItem = {
      locale: 'en_US',
      product: {
        title: (draft.draft_title || shopifyProduct.title).slice(0, 80), // eBay 80 char limit
        description: draft.draft_description || shopifyProduct.descriptionHtml || '',
        imageUrls: draft.draftImages?.length > 0 ? draft.draftImages.slice(0, 12) : // eBay 12 image limit
                   shopifyProduct.images.slice(0, 12).map(img => img.url),
        aspects: {
          Brand: [shopifyProduct.vendor || 'Unbranded'],
          Condition: ['Used'],
          'Item Type': [shopifyProduct.productType || 'Camera Equipment']
        }
      },
      condition: 'USED_VERY_GOOD',
      conditionDescription: 'Used camera equipment in very good condition',
      availability: {
        shipToLocationAvailability: {
          quantity: Math.max(0, variant.inventoryQuantity || 0)
        }
      }
    };

    // Create inventory item
    await createOrReplaceInventoryItem(ebayToken, variant.sku, inventoryItem);
    info(`[DraftsAPI] ✅ Created eBay inventory item for SKU: ${variant.sku}`);

    // Create offer
    const offer = {
      sku: variant.sku,
      marketplaceId: 'EBAY_US',
      format: 'FIXED_PRICE',
      availableQuantity: Math.max(0, variant.inventoryQuantity || 0),
      pricingSummary: {
        price: {
          value: variant.price,
          currency: 'USD'
        }
      },
      listingPolicies: {
        fulfillmentPolicyId: policies.fulfillmentPolicyId,
        paymentPolicyId: policies.paymentPolicyId,
        returnPolicyId: policies.returnPolicyId
      },
      categoryId: '30', // Default camera equipment category
      tax: {
        applyTax: false
      }
    };

    const offerResponse = await createOffer(ebayToken, offer);
    info(`[DraftsAPI] ✅ Created eBay offer: ${offerResponse.offerId}`);

    // Publish offer to make it live
    const publishResponse = await publishOffer(ebayToken, offerResponse.offerId);
    const listingId = publishResponse.listingId;
    info(`[DraftsAPI] ✅ Published eBay listing: ${listingId}`);

    // Save mapping in database
    db.prepare(
      `INSERT INTO product_mappings 
       (shopify_product_id, ebay_listing_id, ebay_inventory_item_id, status, shopify_title, shopify_price, shopify_sku, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    ).run(
      draft.shopify_product_id,
      listingId,
      variant.sku,
      shopifyProduct.title,
      parseFloat(variant.price),
      variant.sku,
      now,
      now
    );

    // Log to sync_log
    db.prepare(
      `INSERT INTO sync_log (direction, entity_type, entity_id, status, detail, created_at)
       VALUES ('shopify_to_ebay', 'product', ?, 'success', ?, ?)`
    ).run(
      draft.shopify_product_id,
      `Created eBay listing ${listingId} from draft ${draftId}`,
      now
    );

    // Update draft status to published
    db.prepare(
      `UPDATE product_drafts SET status = 'published', reviewed_at = ?, reviewed_by = 'system', updated_at = ? 
       WHERE id = ?`
    ).run(now, now, draftId);

    info(`[DraftsAPI] ✅ Draft ${draftId} successfully listed on eBay as ${listingId}`);
    
    res.json({
      success: true,
      listingId,
      offerId: offerResponse.offerId,
      sku: variant.sku,
      title: inventoryItem.product.title,
      price: variant.price,
      quantity: inventoryItem.availability.shipToLocationAvailability.quantity,
      message: `Successfully created eBay listing ${listingId}`
    });

  } catch (err) {
    logError(`[DraftsAPI] List on eBay error: ${err}`);
    
    // Log failure
    try {
      const db = await getRawDb();
      db.prepare(
        `INSERT INTO sync_log (direction, entity_type, entity_id, status, detail, created_at)
         VALUES ('shopify_to_ebay', 'product', ?, 'failed', ?, ?)`
      ).run(
        req.params.id,
        `Failed to create eBay listing: ${err}`,
        Math.floor(Date.now() / 1000)
      );
    } catch (logErr) {
      logError(`[DraftsAPI] Failed to log error: ${logErr}`);
    }

    res.status(500).json({ 
      error: 'Failed to create eBay listing', 
      detail: err instanceof Error ? err.message : String(err) 
    });
  }
});

export default router;
