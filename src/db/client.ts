import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as schema from './schema.js';

// Use env var for DATABASE_PATH, fallback to local development path
const DEFAULT_DB_DIR = path.join(os.homedir(), '.clawdbot');
const DB_PATH = process.env.DATABASE_PATH || path.join(DEFAULT_DB_DIR, 'ebaysync.db');
const DB_DIR = path.dirname(DB_PATH);

export const ensureDbPath = async (): Promise<string> => {
  await fs.mkdir(DB_DIR, { recursive: true });
  return DB_PATH;
};

let dbInstance: ReturnType<typeof drizzle> | null = null;
let rawSqlite: InstanceType<typeof Database> | null = null;

const initTables = (sqlite: InstanceType<typeof Database>) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS product_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_product_id TEXT NOT NULL,
      ebay_listing_id TEXT NOT NULL,
      ebay_inventory_item_id TEXT,
      status TEXT DEFAULT 'active',
      original_price REAL,
      shopify_title TEXT,
      shopify_price REAL,
      shopify_sku TEXT,
      last_republished_at INTEGER,
      promoted_at INTEGER,
      ad_rate REAL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS order_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ebay_order_id TEXT NOT NULL UNIQUE,
      shopify_order_id TEXT NOT NULL,
      shopify_order_name TEXT,
      status TEXT DEFAULT 'synced',
      synced_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      scope TEXT,
      expires_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
};

const initExtraTables = (sqlite: InstanceType<typeof Database>) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS attribute_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,        -- 'sales', 'listing', 'payment', 'shipping'
      field_name TEXT NOT NULL,      -- e.g. 'condition', 'title', 'price', 'upc'
      mapping_type TEXT NOT NULL,    -- 'edit_in_grid', 'constant', 'formula', 'shopify_field'
      source_value TEXT,             -- Shopify field name or formula expression
      target_value TEXT,             -- constant value or eBay field
      variation_mapping TEXT,        -- 'edit_in_grid', 'sku', 'condition', 'same_as_product'
      is_enabled BOOLEAN DEFAULT TRUE,
      display_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(category, field_name)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      topic TEXT,
      message TEXT NOT NULL,
      processed_at INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS product_mapping_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_product_id TEXT NOT NULL,
      category TEXT NOT NULL,
      field_name TEXT NOT NULL,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(shopify_product_id, category, field_name)
    );
    CREATE TABLE IF NOT EXISTS image_processing_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      original_url TEXT NOT NULL,
      processed_url TEXT,
      params_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_image_processing_log_product ON image_processing_log(product_id);
    CREATE INDEX IF NOT EXISTS idx_image_processing_log_status ON image_processing_log(status);
    CREATE TABLE IF NOT EXISTS product_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_product_id TEXT NOT NULL,
      draft_title TEXT,
      draft_description TEXT,
      draft_images_json TEXT,
      original_title TEXT,
      original_description TEXT,
      original_images_json TEXT,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      auto_publish INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      reviewed_at INTEGER,
      reviewed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_product_drafts_shopify_id ON product_drafts(shopify_product_id);
    CREATE INDEX IF NOT EXISTS idx_product_drafts_status ON product_drafts(status);
    CREATE TABLE IF NOT EXISTS auto_publish_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_type TEXT NOT NULL UNIQUE,
      enabled INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS product_pipeline_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_product_id TEXT NOT NULL UNIQUE,
      ai_description_generated INTEGER DEFAULT 0,
      ai_description TEXT,
      ai_category_id TEXT,
      images_processed INTEGER DEFAULT 0,
      images_processed_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pipeline_jobs (
      id TEXT PRIMARY KEY,
      shopify_product_id TEXT NOT NULL,
      shopify_title TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      current_step TEXT,
      steps_json TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ebay_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ebay_order_id TEXT NOT NULL UNIQUE,
      legacy_order_id TEXT,
      buyer_username TEXT,
      order_status TEXT,
      fulfillment_status TEXT,
      payment_status TEXT,
      total_amount REAL,
      currency TEXT DEFAULT 'USD',
      item_count INTEGER,
      line_items_json TEXT,
      shipping_address_json TEXT,
      ebay_created_at TEXT,
      ebay_modified_at TEXT,
      synced_to_shopify INTEGER DEFAULT 0,
      shopify_order_id TEXT,
      imported_at INTEGER NOT NULL DEFAULT (unixepoch()),
      raw_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ebay_orders_fulfillment ON ebay_orders(fulfillment_status);
    CREATE INDEX IF NOT EXISTS idx_ebay_orders_payment ON ebay_orders(payment_status);
    CREATE INDEX IF NOT EXISTS idx_ebay_orders_buyer ON ebay_orders(buyer_username);
    CREATE TABLE IF NOT EXISTS help_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      asked_by TEXT,
      answered_by TEXT,
      category TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS feature_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      priority TEXT DEFAULT 'medium',
      requested_by TEXT,
      completed_at TEXT,
      admin_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS feature_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id INTEGER NOT NULL,
      voter_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(feature_id, voter_id)
    );
    CREATE INDEX IF NOT EXISTS idx_feature_votes_feature ON feature_votes(feature_id);
  `);
};

const seedDefaultMappings = async (sqlite: InstanceType<typeof Database>) => {
  const insert = sqlite.prepare(`
    INSERT INTO attribute_mappings 
    (category, field_name, mapping_type, source_value, target_value, variation_mapping, display_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(category, field_name) DO UPDATE SET
      mapping_type = excluded.mapping_type,
      source_value = excluded.source_value,
      target_value = excluded.target_value,
      variation_mapping = excluded.variation_mapping,
      display_order = excluded.display_order,
      updated_at = datetime('now')
  `);

  // Sales attributes — auto-fill from Shopify where possible
  const salesMappings = [
    ['sales', 'status', 'constant', null, 'active', null, 1],
    ['sales', 'sku', 'shopify_field', 'variants[0].sku', null, 'sku', 2],
    ['sales', 'quantity', 'shopify_field', 'variants[0].inventory_quantity', null, 'edit_in_grid', 3],
    ['sales', 'price', 'shopify_field', 'variants[0].price', null, 'edit_in_grid', 4],
    ['sales', 'recommended_retail_price', 'shopify_field', 'variants[0].compare_at_price', null, null, 5],
    ['sales', 'inventory_location', 'constant', null, 'all', null, 6],
    ['sales', 'sync_quantity', 'constant', null, 'true', null, 7],
    ['sales', 'sync_price', 'constant', null, 'true', null, 8],
  ];

  // Listing attributes — auto-fill title, description, UPC from Shopify
  const listingMappings = [
    ['listing', 'title', 'shopify_field', 'title', null, null, 1],
    ['listing', 'subtitle', 'edit_in_grid', null, null, null, 2],
    ['listing', 'description', 'shopify_field', 'body_html', null, null, 3],
    ['listing', 'mobile_description', 'shopify_field', 'body_html', null, null, 4],
    ['listing', 'primary_category', 'edit_in_grid', null, null, null, 5],
    ['listing', 'secondary_category', 'edit_in_grid', null, null, null, 6],
    ['listing', 'store_primary_category', 'edit_in_grid', null, null, null, 7],
    ['listing', 'store_secondary_category', 'edit_in_grid', null, null, null, 8],
    ['listing', 'best_offer', 'constant', null, 'true', null, 9],
    ['listing', 'best_offer_auto_accept', 'edit_in_grid', null, null, null, 10],
    ['listing', 'best_offer_auto_decline', 'edit_in_grid', null, null, null, 11],
    ['listing', 'epid', 'edit_in_grid', null, null, null, 12],
    ['listing', 'private_listing', 'constant', null, 'false', null, 13],
    ['listing', 'condition', 'constant', null, 'Used', null, 14],
    ['listing', 'condition_description', 'edit_in_grid', null, null, null, 15],
    ['listing', 'upc', 'shopify_field', 'variants[0].barcode', null, null, 16],
    ['listing', 'ean', 'edit_in_grid', null, null, null, 17],
    ['listing', 'isbn', 'edit_in_grid', null, null, null, 18],
    ['listing', 'vat_percent', 'constant', null, '0', null, 19],
  ];

  // Shipping attributes — sensible defaults for Pictureline
  const shippingMappings = [
    ['shipping', 'handling_time', 'constant', null, '1', null, 1],
    ['shipping', 'weight', 'shopify_field', 'variants[0].weight', null, null, 2],
    ['shipping', 'width', 'edit_in_grid', null, null, null, 3],
    ['shipping', 'height', 'edit_in_grid', null, null, null, 4],
    ['shipping', 'length', 'edit_in_grid', null, null, null, 5],
    ['shipping', 'item_location', 'constant', null, 'Salt Lake City, UT', null, 6],
    ['shipping', 'item_location_postal_code', 'constant', null, '84101', null, 7],
    ['shipping', 'item_location_country_code', 'constant', null, 'US', null, 8],
    ['shipping', 'domestic_cost_type', 'constant', null, 'Flat', null, 9],
    ['shipping', 'domestic_shipping_free', 'constant', null, 'true', null, 10],
    ['shipping', 'global_shipping_program', 'constant', null, 'false', null, 11],
  ];

  // Payment attributes — eBay managed payments (modern default)
  const paymentMappings = [
    ['payment', 'paypal_accepted', 'constant', null, 'false', null, 1],
    ['payment', 'immediate_payment', 'constant', null, 'true', null, 2],
    ['payment', 'paypal_email', 'constant', null, '', null, 3],
  ];

  const allMappings = [...salesMappings, ...listingMappings, ...shippingMappings, ...paymentMappings];
  
  for (const mapping of allMappings) {
    // better-sqlite3 can bind null, but ensure no undefined values
    insert.run(...mapping.map(v => v === undefined ? null : v));
  }
};

/**
 * Seed comprehensive help/FAQ content.
 */
const seedHelpContent = (sqlite: InstanceType<typeof Database>) => {
  const insert = sqlite.prepare(`
    INSERT OR IGNORE INTO help_questions (question, answer, status, answered_by, category)
    SELECT ?, ?, 'published', 'System', ?
    WHERE NOT EXISTS (SELECT 1 FROM help_questions WHERE question = ?)
  `);

  const entries: [string, string, string][] = [
    [
      'How do I sync products from Shopify to eBay?',
      `Syncing products from Shopify to eBay is one of the core features of ProductPipeline. Here's how to do it step by step:

1. Navigate to the **Products** page from the left sidebar. You'll see a list of all your Shopify products with their sync status.
2. Select the products you want to sync by clicking the checkboxes next to them. You can use the search bar and filters to find specific products.
3. Click the **Sync to eBay** button at the top of the page. This will push the selected products to eBay using your configured field mappings.
4. The sync process will map your Shopify product data (title, description, price, images, inventory) to eBay listing fields based on your mapping configuration.

Before syncing, make sure your field mappings are configured correctly on the **Mappings** page. The mappings control how Shopify fields translate to eBay listing fields across four categories: Sales, Listing, Shipping, and Payment. If you need to customize settings for individual products, use Per-Product Overrides on the product detail page.

You can also use the **Auto-Listing Pipeline** for hands-free listing. New Shopify products automatically flow through enrichment stages (AI-generated titles, image processing) before being listed on eBay. Check the Pipeline page to monitor progress.`,
      'Products',
    ],
    [
      'How do I manage field mappings?',
      `Field mappings control how your Shopify product data translates to eBay listing fields. They are organized into four categories:

**Sales Mappings**: Control pricing and inventory fields — SKU, quantity, price, recommended retail price, inventory location, and sync toggles. Most of these auto-fill from Shopify product data.

**Listing Mappings**: Control how your listing appears on eBay — title, subtitle, description, categories, condition, best offer settings, and product identifiers (UPC, EAN, ISBN). The title and description pull from Shopify by default but can be customized.

**Shipping Mappings**: Configure handling time, package dimensions, item location, and shipping cost settings. These default to Pictureline's Salt Lake City location with free domestic shipping.

**Payment Mappings**: Set up payment preferences. Since eBay uses managed payments, most settings here are pre-configured (immediate payment required, no PayPal needed).

To manage mappings, go to **Mappings** in the left sidebar. Each field shows its mapping type (Shopify field, constant value, formula, or edit-in-grid). Click on any field to change its mapping type or value. You can also use the **Export/Import** feature to back up your mappings or transfer them between environments.`,
      'Mappings',
    ],
    [
      'What is the auto-listing pipeline?',
      `The auto-listing pipeline is an automated workflow that takes new Shopify products and lists them on eBay with minimal manual intervention. Here's how the full flow works:

**Stage 1 — Pending**: When a new product is added to Shopify, it enters the pipeline as "pending." The system detects it during the next sync cycle.

**Stage 2 — Enrichment**: The product goes through AI enrichment where titles and descriptions are optimized for eBay search. The AI generates eBay-friendly titles (up to 80 characters) and compelling descriptions based on the Shopify product data.

**Stage 3 — Image Processing**: Product images are sent through PhotoRoom for background removal and enhancement. Images are resized and optimized for eBay's requirements, ensuring they look professional and load quickly.

**Stage 4 — Ready**: Once enrichment and image processing are complete, the product is marked as "ready" for listing.

**Stage 5 — Listed**: The product is automatically listed on eBay using your configured field mappings, shipping settings, and payment preferences.

You can monitor the pipeline on the **Pipeline** page, which shows all jobs and their current stages. If any step fails, the pipeline provides clear error messages so you can fix issues and retry. You can also manually trigger the pipeline for specific products using the auto-list button on the product detail page.`,
      'Pipeline',
    ],
    [
      'How does image processing work?',
      `ProductPipeline uses PhotoRoom integration to automatically process and enhance product images before they're listed on eBay. Here's what happens:

When a product enters the auto-listing pipeline or when you manually trigger image processing, the system sends each product image to the PhotoRoom API. PhotoRoom performs several operations: background removal (replacing cluttered backgrounds with clean white or custom backgrounds), automatic cropping and centering, and image enhancement to improve brightness and contrast.

You can configure image templates that control the output style — white background for product shots, lifestyle backgrounds for certain categories, or custom branded templates. The processed images are then cached and used when creating or updating eBay listings.

To check the status of image processing, visit the **Images** page from the Pipeline section in the left sidebar. You'll see a queue of pending images, processing status, and completed results. If an image fails processing, you can retry it individually or in bulk.

Image processing requires a valid PhotoRoom API key configured in your environment settings. The system processes images asynchronously so it doesn't block the listing pipeline — products can continue through other stages while images are being processed.`,
      'Pipeline',
    ],
    [
      'How do I manage orders?',
      `Order management in ProductPipeline syncs eBay orders into Shopify for unified fulfillment. Here's how it works:

Navigate to the **Orders** page from the eBay section in the left sidebar. You'll see all synced orders with their status, amounts, and sync timestamps. You can search and filter orders by status, date range, or order ID.

**Important Safety Guard**: Order sync always uses a date filter to prevent accidentally importing old orders. The system only syncs orders from a recent time window (typically the last 24 hours for auto-sync). This protects against duplicate imports and ensures your Shopify order list stays clean. This safety guard cannot be disabled — it's a core protection built into the system.

When an order is synced, ProductPipeline creates a corresponding order in Shopify with all the line items, customer information, and shipping details from the eBay sale. The Shopify order is then used for fulfillment, shipping label generation, and tracking updates.

Auto-sync can be enabled in **Settings** to automatically check for new eBay orders at your configured interval (default: every 5 minutes). You can also manually trigger an order sync from the Orders page. The sync log on the Analytics page shows the history of all sync operations including any errors encountered.`,
      'Orders',
    ],
    [
      'What are per-product overrides?',
      `Per-product overrides let you customize individual product settings that differ from your global field mappings. This is useful when a specific product needs a different eBay category, custom title, special pricing, or unique shipping settings.

To set overrides, navigate to the **Products** page and click on a specific product to open its detail view. You'll see an "Overrides" section where you can set custom values for any mapped field. These overrides take priority over the global mappings when that product is synced to eBay.

Common use cases for overrides include: setting a custom eBay title that's different from the Shopify title, choosing a specific eBay category for an unusual product, setting a different price for eBay vs Shopify, adding a custom condition description for a particular item, or specifying unique shipping dimensions.

Overrides are stored per-product and persist across sync operations. When you sync a product with overrides, the system uses the override value instead of the global mapping for that specific field. All other fields still use the global mappings. You can remove an override at any time to revert to the global mapping for that field.

The overrides system works across all four mapping categories (Sales, Listing, Shipping, Payment), so you have complete flexibility to customize any aspect of how a product appears on eBay.`,
      'Products',
    ],
    [
      'How do I use the chat assistant?',
      `The AI chat assistant is available throughout the app via the chat widget in the bottom-right corner. It can help you with a wide range of tasks:

**Ask Questions**: Type any question about the app, your products, listings, or orders. The assistant understands the full capabilities of ProductPipeline and can provide step-by-step guidance.

**Run Commands**: The assistant can execute actions on your behalf — sync products, check order status, run the pipeline, update settings, and more. Just describe what you want to do in natural language.

**Navigate the App**: Ask the assistant to take you to specific pages or features. For example, "show me the mappings page" or "take me to pipeline status."

**Get Status Updates**: Ask "what's the status" or "are there any errors" to get a quick overview of your sync operations, listing health, and system status.

The chat assistant uses the capabilities registry to stay up-to-date with all available features. When new features are added to ProductPipeline, the assistant automatically learns about them and can help you use them. You can access the chat from any page in the app — it maintains context across your conversation so you can have multi-step interactions.`,
      'Chat',
    ],
    [
      'How do I submit a feature request?',
      `ProductPipeline includes a built-in feature request system so you can suggest improvements and new features directly from the app.

To submit a feature request, navigate to **Feature Requests** in the Settings & Analytics section of the left sidebar, or go directly to the /features page. Click the "Submit Request" button and fill out the form with a title and description of the feature you'd like to see.

You can optionally set a priority level (low, medium, high, critical) and provide your name so the team knows who requested it. Be as specific as possible in your description — include use cases, examples, and why the feature would be valuable.

After submission, your request will appear in the feature request list with a "New" status. The admin team reviews requests regularly and updates their status as they progress: New → Planned → In Progress → Completed. You can check back on the Feature Requests page anytime to see the current status of your requests and any admin notes.

The feature request system helps prioritize development work based on actual user needs. Even if a feature isn't implemented immediately, it's tracked and considered for future releases.`,
      'General',
    ],
    [
      'What do the pipeline stages mean?',
      `The auto-listing pipeline processes products through several stages before they're listed on eBay. Here's what each stage means:

**Pending**: The product has been detected and added to the pipeline queue but hasn't been processed yet. This is the initial state for all new products entering the pipeline.

**Enriching**: The product is currently being processed by the AI enrichment system. This includes generating optimized eBay titles (within the 80-character limit), creating compelling descriptions, and mapping category-specific item specifics.

**Enriched**: AI enrichment is complete. The product now has optimized titles and descriptions ready for listing. It's waiting for image processing to complete.

**Processing Images**: Product images are being sent through PhotoRoom for background removal, enhancement, and optimization. This stage runs in parallel when possible.

**Ready**: All processing is complete — the product has enriched content and processed images. It's ready to be listed on eBay.

**Listed**: The product has been successfully listed on eBay. The eBay listing ID is stored in the product mapping for future sync operations.

**Failed**: Something went wrong during processing. Check the error details on the Pipeline page to diagnose and fix the issue. Common failures include missing images, API rate limits, or invalid product data. You can retry failed jobs individually or in bulk.

Monitor all stages on the **Pipeline** page (Pipeline > Overview in the sidebar).`,
      'Pipeline',
    ],
    [
      'How do I check listing health?',
      `The Listing Health feature gives you an overview of how your eBay listings are performing and identifies items that may need attention.

Navigate to the **Dashboard** or check the **Analytics** page for the listing health report. The health report shows: total active listings, total ended listings, age distribution (how long items have been listed), average days listed, and counts of price-dropped, republished, and promoted listings.

**Stale Listings**: Listings that haven't been updated in a while may lose visibility on eBay. ProductPipeline identifies stale listings (configurable threshold, default 30 days) and can automatically republish them to boost their search ranking. Go to Listings and look for the stale indicator, or use the chat assistant to ask "show stale listings."

**Republishing**: Stale listings can be republished automatically or manually. Republishing refreshes the listing date on eBay, which can improve search visibility. Configure the republish threshold in Settings under "Listing Management."

**Price Drops**: If items haven't sold after a configurable period (default 14 days), ProductPipeline can automatically apply a price drop (default 10%). This makes items more competitive and can increase sell-through rates. The original price is preserved so you can restore it later.

For a detailed health check, use the chat assistant and ask "how healthy are my listings" to get a comprehensive analysis with specific recommendations.`,
      'Analytics',
    ],
    [
      'How do price drops work?',
      `The automatic price drop feature helps sell slow-moving inventory by gradually reducing prices on listings that haven't sold within a configurable timeframe.

**How It Works**: When a listing has been active for longer than the configured threshold (default: 14 days without a sale), ProductPipeline can automatically reduce the price by a percentage (default: 10%). The original price is always preserved in the database so you can restore it later if needed.

**Configuration**: Go to **Settings** and find the "Listing Management" section. You can configure: whether price drops are enabled, the number of days before a price drop is applied, and the percentage to drop. These settings apply globally but can be overridden per-product using the override system.

**Safety Guards**: Price drops never go below a minimum threshold to protect your margins. The system tracks which listings have already had price drops applied to avoid double-dropping. You can see which listings have been price-dropped in the listing health report.

**Manual Control**: You can also apply price drops manually from the Listings page or through the chat assistant. Ask "apply price drops" to trigger a manual run, or "drop prices on stale items" to target only items that meet the staleness criteria. All price drop actions are logged in the Analytics page so you have a full audit trail.`,
      'Products',
    ],
    [
      'How do I export/import mappings?',
      `ProductPipeline supports exporting and importing field mappings so you can back up your configuration or transfer it between environments.

**Exporting Mappings**: Go to the **Mappings** page and click the "Export" button. This downloads a JSON file containing all your current field mappings across all four categories (Sales, Listing, Shipping, Payment). The export includes mapping types, source values, target values, variation mappings, and display order — everything needed to fully restore your configuration.

**Importing Mappings**: On the same Mappings page, click "Import" and select a previously exported JSON file. The import will update existing mappings and add any new ones. Existing mappings that aren't in the import file are left unchanged, so you can safely do partial imports.

**Bulk Updates**: For advanced users, the bulk mapping API endpoint (POST /api/mappings/bulk) accepts an array of mapping objects and applies them all at once. This is useful for programmatic configuration or when migrating settings.

**Best Practices**: Export your mappings before making major changes so you have a backup. If you're setting up a new environment, export from your working environment and import into the new one. The export file is human-readable JSON, so you can also edit it manually if needed before importing.`,
      'Mappings',
    ],
    [
      'What is the capabilities registry?',
      `The capabilities registry is an internal system that tracks all features available in ProductPipeline. It serves two important purposes:

**For the Chat Assistant**: The AI chat assistant uses the capabilities registry to know what features exist and how to help you use them. When a new feature is added to ProductPipeline, it's registered in the capabilities system, and the chat assistant automatically learns about it. This means you can always ask the chat "what can you do?" and get an accurate, up-to-date answer.

**For Feature Discovery**: The registry tracks when each feature was added. Features added in the last 7 days are marked as "new" and can be highlighted in the UI. This helps you discover new functionality without reading changelogs or documentation.

Each capability includes: a unique ID, display name, description, category (Shopify, eBay, Pipeline, Images, Analytics, Settings), example prompts for the chat assistant, and the API endpoints it uses. You can view all capabilities at the /api/capabilities endpoint.

The registry is designed to be self-documenting — as the app grows, the registry grows with it, ensuring that documentation, chat capabilities, and feature discovery all stay in sync automatically.`,
      'General',
    ],
    [
      'How do I filter and search products?',
      `ProductPipeline provides powerful filtering and search capabilities to help you find and manage your products efficiently.

**Search**: On the **Products** page, use the search bar at the top to search by product title, SKU, or eBay listing ID. The search is case-insensitive and matches partial strings, so you can search for "canon" to find all Canon products, or enter a specific SKU to find a single item.

**Status Filters**: Filter products by their sync status — active (currently listed on eBay), pending (not yet synced), ended (listing has ended), or all. This helps you quickly find products that need attention, like items that haven't been listed yet.

**Pagination**: Products are displayed in pages (default 20 per page) to keep the interface responsive. Use the pagination controls at the bottom to navigate through your product catalog. The total count is always shown so you know how many products match your current filters.

**Sorting**: Products can be sorted by various fields including title, price, status, and last updated date. Click on column headers to toggle sort direction.

**Combining Filters**: You can combine search with status filters to narrow down results. For example, search for "lens" with status "active" to see all currently listed lens products. The URL updates with your filter parameters so you can bookmark specific views or share them.`,
      'Products',
    ],
    [
      'What safety guards are in place?',
      `ProductPipeline includes several safety guards to protect your data and prevent accidental damage:

**Order Sync Date Filter**: The most critical safety guard — order sync ALWAYS uses a date filter. The system only imports orders from a recent time window (typically the last 24 hours). This prevents accidentally importing thousands of old orders, creating duplicate entries, or overwhelming your Shopify store. This guard cannot be disabled.

**Auto-Sync Disabled by Default**: Automatic background sync is turned off by default. You must explicitly enable it in Settings. This ensures you understand and approve the sync behavior before it runs automatically.

**Rate Limiting**: All API endpoints are rate-limited to prevent accidental floods of requests. The eBay and Shopify APIs have their own rate limits, and ProductPipeline respects them with automatic retry and backoff logic.

**Price Drop Safeguards**: Automatic price drops never reduce prices below a minimum threshold. The original price is always preserved so you can restore it. Price drops are tracked and logged for full auditability.

**Data Preservation**: ProductPipeline never deletes data from Shopify or eBay. All operations are additive — creating new listings, updating existing ones, or importing orders. The system maintains a complete sync log so you can audit every action taken.

**Error Handling**: All sync operations include comprehensive error handling. If something fails, the error is logged with details, and the system continues processing remaining items rather than stopping entirely. Failed operations can be retried individually.`,
      'General',
    ],
    [
      'How do I get started with ProductPipeline?',
      `Getting started with ProductPipeline involves a few setup steps to connect your Shopify and eBay accounts and configure your preferences:

**Step 1 — Connect Shopify**: Go to **Settings** and enter your Shopify store credentials. ProductPipeline needs your store URL and API access token to read product data and create orders. The connection status is shown on the Dashboard.

**Step 2 — Connect eBay**: In Settings, follow the eBay authentication flow. You'll be redirected to eBay to authorize ProductPipeline to manage your listings. Once connected, the eBay token is stored securely and refreshes automatically.

**Step 3 — Configure Mappings**: Visit the **Mappings** page to review and customize how your Shopify product fields map to eBay listing fields. The defaults are pre-configured for a camera gear business, but you may want to adjust categories, shipping settings, or pricing rules.

**Step 4 — Test with a Single Product**: Before bulk syncing, try listing a single product. Go to Products, select one item, and sync it to eBay. Verify the listing looks correct on eBay before proceeding with more products.

**Step 5 — Enable Auto Features**: Once you're comfortable with the basic workflow, consider enabling the auto-listing pipeline (for new products) and auto-sync (for regular inventory and price updates). Configure these in Settings under their respective sections.

The Dashboard provides a quick overview of your connections, product counts, and recent sync activity. Check it regularly to ensure everything is running smoothly. If you need help at any point, use the chat assistant or browse this FAQ.`,
      'General',
    ],
    [
      'How do I troubleshoot sync errors?',
      `When sync operations encounter errors, ProductPipeline provides detailed logging and diagnostics to help you identify and fix issues:

**Check the Analytics Page**: Go to **Analytics** (also labeled "Logs" in the sidebar) to see a chronological list of all sync operations and their outcomes. Each log entry includes the operation type, entity ID, status (success/failure), and detailed error messages.

**Common Error Types**: The most frequent sync errors include: eBay API rate limits (wait and retry), invalid product data (missing required fields), expired authentication tokens (re-authenticate in Settings), and image processing failures (check image URLs are accessible).

**eBay Token Issues**: If you see authentication errors, your eBay token may have expired. Go to Settings and re-authorize your eBay connection. Tokens typically last 2 hours for access and 18 months for refresh tokens.

**Missing Field Errors**: If eBay rejects a listing for missing required fields, check your Mappings page to ensure all required eBay fields have values — either from Shopify field mappings or constant values. Common missing fields include condition, category, and return policy settings.

**Retry Failed Operations**: Most sync operations can be retried individually. On the Pipeline page, failed jobs have a "Retry" button. For product sync failures, you can re-select the product and sync again. The system is idempotent — re-syncing an already-listed product updates it rather than creating a duplicate.

If errors persist, use the chat assistant to describe the problem. It can check logs, identify patterns, and suggest specific fixes based on the error details.`,
      'General',
    ],
    [
      'What eBay listing formats are supported?',
      `ProductPipeline currently supports eBay's fixed-price listing format (also known as "Buy It Now"), which is the most common format for professional sellers.

**Fixed-Price Listings**: All listings created through ProductPipeline are fixed-price with optional Best Offer. This format is ideal for used camera gear because buyers can purchase immediately or make offers. You can configure Best Offer settings in your field mappings, including auto-accept and auto-decline thresholds.

**Listing Duration**: Listings are created as "Good Til Cancelled" (GTC), meaning they stay active until the item sells or you manually end the listing. This is the standard for professional eBay sellers and avoids the need to constantly relist items.

**Condition Settings**: For used camera gear, condition is important. ProductPipeline supports all eBay condition values: New, Like New, Very Good, Good, Acceptable, and For Parts/Not Working. The default is "Used" but you can customize per-product. You can also add a condition description to provide specific details about wear, functionality, or included accessories.

**Item Specifics**: eBay requires category-specific item specifics (Brand, Model, Type, etc.). ProductPipeline maps these from your Shopify product data where possible and allows manual entry for fields that don't have a Shopify equivalent. The category mapper automatically selects the best eBay category based on your product type.`,
      'Products',
    ],
    [
      'How does inventory sync work?',
      `Inventory sync keeps your eBay listing quantities in sync with your Shopify inventory levels, preventing overselling and ensuring accurate availability.

**Automatic Updates**: When enabled, ProductPipeline periodically checks your Shopify inventory levels and updates the corresponding eBay listings. If an item sells on Shopify, the eBay quantity is reduced. If you restock, the eBay quantity increases.

**Sync Direction**: Inventory sync flows from Shopify → eBay. Shopify is treated as the source of truth for inventory. When an eBay order is synced to Shopify, the Shopify inventory is decremented there, and the next inventory sync cycle updates the remaining eBay listings.

**Configuration**: Go to **Settings** to configure inventory sync. You can enable/disable inventory sync independently from price sync. The sync interval (default 5 minutes) controls how frequently inventory levels are checked and updated.

**Per-Product Control**: In your field mappings, the "sync_quantity" setting controls whether inventory sync is active. You can override this per-product if you want to manage certain items manually. The "inventory_location" setting determines which Shopify location's inventory is used.

**Safety**: Inventory sync will never increase eBay quantity above the Shopify quantity. If there's a discrepancy, the system defaults to the lower number to prevent overselling. All inventory updates are logged in the sync history for auditability.`,
      'Products',
    ],
    [
      'How do I contact support?',
      `There are several ways to get help with ProductPipeline:

**In-App Chat Assistant**: The fastest way to get help is through the AI chat assistant, available via the chat widget in the bottom-right corner of every page. The assistant can answer questions about features, troubleshoot issues, run diagnostic commands, and guide you through workflows.

**Help & FAQ**: You're already here! The FAQ page contains comprehensive documentation on all major features. Use the search bar and category filters to find relevant answers quickly.

**Submit a Question**: If you can't find an answer in the FAQ, click "Ask a Question" at the top of this page. Your question will be reviewed and answered — if the AI can answer it automatically, you'll get an instant response. Otherwise, an admin will respond.

**Feature Requests**: Have an idea for improving ProductPipeline? Submit a feature request at the **Feature Requests** page (Settings & Analytics > Feature Requests). Describe the feature you'd like and why it would be useful.

**Analytics & Logs**: If you're experiencing technical issues, check the Analytics page for error logs. Having specific error messages ready when seeking help makes troubleshooting much faster.

ProductPipeline is actively maintained and improved based on user feedback. Don't hesitate to reach out — whether it's a bug report, feature idea, or just a question about how something works.`,
      'General',
    ],
  ];

  for (const [question, answer, category] of entries) {
    insert.run(question, answer, category, question);
  }
};

/**
 * Seed default settings if not already present.
 */
const seedDefaultSettings = (sqlite: InstanceType<typeof Database>) => {
  const upsert = sqlite.prepare(`
    INSERT INTO settings (key, value, updatedAt)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO NOTHING
  `);

  const defaults: [string, string][] = [
    [
      'description_prompt',
      '', // Use empty string — code default in auto-listing-pipeline.ts is the source of truth
    ],
    ['photoroom_template_id', ''],
    ['pipeline_auto_descriptions', '0'],
    ['pipeline_auto_images', '0'],
    ['draft_auto_publish_no_photos', 'false'],
    ['draft_auto_publish_no_description', 'false'],
  ];

  for (const [key, value] of defaults) {
    upsert.run(key, value);
  }
};

/**
 * Migrate existing product_mappings table — add new columns if missing.
 */
const migrateProductMappings = (sqlite: InstanceType<typeof Database>) => {
  const cols = sqlite.prepare(`PRAGMA table_info(product_mappings)`).all() as any[];
  const colNames = new Set(cols.map((c: any) => c.name));

  const migrations: [string, string][] = [
    ['original_price', 'ALTER TABLE product_mappings ADD COLUMN original_price REAL'],
    ['last_republished_at', 'ALTER TABLE product_mappings ADD COLUMN last_republished_at INTEGER'],
    ['promoted_at', 'ALTER TABLE product_mappings ADD COLUMN promoted_at INTEGER'],
    ['ad_rate', 'ALTER TABLE product_mappings ADD COLUMN ad_rate REAL'],
    ['shopify_title', 'ALTER TABLE product_mappings ADD COLUMN shopify_title TEXT'],
    ['shopify_price', 'ALTER TABLE product_mappings ADD COLUMN shopify_price REAL'],
    ['shopify_sku', 'ALTER TABLE product_mappings ADD COLUMN shopify_sku TEXT'],
  ];

  for (const [colName, sql] of migrations) {
    if (!colNames.has(colName)) {
      sqlite.exec(sql);
    }
  }
};

/**
 * Migrate product_drafts table — add eBay listing/offer ID columns if missing.
 */
const migrateProductDraftsEbay = (sqlite: InstanceType<typeof Database>) => {
  const cols = sqlite.prepare(`PRAGMA table_info(product_drafts)`).all() as any[];
  const colNames = new Set(cols.map((c: any) => c.name));

  if (!colNames.has('ebay_listing_id')) {
    sqlite.exec(`ALTER TABLE product_drafts ADD COLUMN ebay_listing_id TEXT`);
  }
  if (!colNames.has('ebay_offer_id')) {
    sqlite.exec(`ALTER TABLE product_drafts ADD COLUMN ebay_offer_id TEXT`);
  }
};

/**
 * Migrate product_mappings table — add product_notes column if missing.
 */
const migrateProductNotes = (sqlite: InstanceType<typeof Database>) => {
  const cols = sqlite.prepare(`PRAGMA table_info(product_mappings)`).all() as any[];
  const colNames = new Set(cols.map((c: any) => c.name));

  if (!colNames.has('product_notes')) {
    sqlite.exec(`ALTER TABLE product_mappings ADD COLUMN product_notes TEXT DEFAULT ''`);
  }
};

/**
 * Migrate help_questions table — add sort_order column if missing.
 */
const migrateHelpQuestions = (sqlite: InstanceType<typeof Database>) => {
  const cols = sqlite.prepare(`PRAGMA table_info(help_questions)`).all() as any[];
  const colNames = new Set(cols.map((c: any) => c.name));

  if (!colNames.has('sort_order')) {
    sqlite.exec('ALTER TABLE help_questions ADD COLUMN sort_order INTEGER DEFAULT 0');
  }
};

/**
 * Seed "Getting Started" articles and assign sort_order to all seed content.
 */
const seedGettingStartedContent = (sqlite: InstanceType<typeof Database>) => {
  const insert = sqlite.prepare(`
    INSERT OR IGNORE INTO help_questions (question, answer, status, answered_by, category, sort_order)
    SELECT ?, ?, 'published', 'System', ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM help_questions WHERE question = ?)
  `);

  const entries: [string, string, string, number][] = [
    [
      'Welcome to ProductPipeline',
      `Welcome to ProductPipeline — your all-in-one solution for syncing products between Shopify and eBay!

ProductPipeline was built specifically for Pictureline, a camera store in Salt Lake City, to automate the process of listing used camera gear on eBay from their Shopify inventory. Here's what you can do:

**Sync Products** — Push your Shopify products to eBay with configurable field mappings that control how titles, descriptions, prices, and images translate between platforms.

**Auto-Listing Pipeline** — New Shopify products can automatically flow through AI enrichment (optimized titles and descriptions), image processing (background removal via PhotoRoom), and get listed on eBay with zero manual work.

**Manage Orders** — eBay orders sync back to Shopify for unified fulfillment. Safety guards ensure only recent orders are imported.

**Smart Features** — Automatic price drops for slow-moving inventory, listing health monitoring, republishing stale listings, and a built-in AI chat assistant.

Use the sidebar navigation to explore these docs, or check out the quick-start guide to get set up in minutes.`,
      'Getting Started',
      1,
    ],
    [
      'Quick Start Guide',
      `Get ProductPipeline up and running in 5 steps:

**Step 1 — Connect Shopify**
Go to **Settings** and enter your Shopify store URL and API access token. The Dashboard will show your connection status.

**Step 2 — Connect eBay**
In **Settings**, click the eBay authentication button. You'll be redirected to eBay to authorize access. Once complete, your token refreshes automatically.

**Step 3 — Review Field Mappings**
Visit the **Mappings** page to see how Shopify fields map to eBay listing fields. The defaults work well for camera gear, but you can customize categories, shipping, and pricing.

**Step 4 — Test with One Product**
Go to **Products**, find a test item, and click **Sync to eBay**. Verify the listing looks correct on eBay before syncing more products.

**Step 5 — Enable Automation**
Once you're comfortable, turn on the auto-listing pipeline in Settings. New products will automatically get AI-enhanced titles, processed images, and be listed on eBay.

That's it! Check the **Dashboard** regularly for sync status and health metrics.`,
      'Getting Started',
      2,
    ],
    [
      'Understanding the Dashboard',
      `The Dashboard is your command center for monitoring ProductPipeline activity. Here's what each section shows:

**Connection Status** — Shows whether Shopify and eBay are connected and healthy. Green means connected; red means you need to re-authenticate or check your credentials.

**Product Stats** — Total mapped products, active eBay listings, and pending sync items. This gives you a quick overview of your inventory status across platforms.

**Recent Activity** — A feed of the latest sync operations, order imports, and pipeline events. Check this to verify things are running smoothly or to spot errors.

**Listing Health** — Summary metrics including average days listed, stale listing count, and price-dropped items. Use this to identify slow-moving inventory that might need attention.

The Dashboard auto-refreshes every 15 seconds, so you're always seeing current data. For deeper analytics, check the **Analytics** page.`,
      'Getting Started',
      3,
    ],
  ];

  for (const [question, answer, category, sortOrder] of entries) {
    insert.run(question, answer, category, sortOrder, question);
  }

  // Assign sort_order to existing seed content where not set
  const sortOrders: Record<string, [string, number][]> = {
    Products: [
      ['How do I sync products from Shopify to eBay?', 1],
      ['What are per-product overrides?', 2],
      ['How do I filter and search products?', 3],
      ['How do price drops work?', 4],
      ['What eBay listing formats are supported?', 5],
      ['How does inventory sync work?', 6],
    ],
    Mappings: [
      ['How do I manage field mappings?', 1],
      ['How do I export/import mappings?', 2],
    ],
    Pipeline: [
      ['What is the auto-listing pipeline?', 1],
      ['What do the pipeline stages mean?', 2],
      ['How does image processing work?', 3],
    ],
    Orders: [
      ['How do I manage orders?', 1],
    ],
    Analytics: [
      ['How do I check listing health?', 1],
    ],
    Chat: [
      ['How do I use the chat assistant?', 1],
    ],
    General: [
      ['How do I get started with ProductPipeline?', 1],
      ['What safety guards are in place?', 2],
      ['How do I troubleshoot sync errors?', 3],
      ['What is the capabilities registry?', 4],
      ['How do I submit a feature request?', 5],
      ['How do I contact support?', 6],
    ],
  };

  const updateSort = sqlite.prepare(
    `UPDATE help_questions SET sort_order = ? WHERE question = ? AND sort_order = 0`,
  );

  for (const [, articles] of Object.entries(sortOrders)) {
    for (const [question, order] of articles) {
      updateSort.run(order, question);
    }
  }
};

/**
 * Normalize help_questions categories to Title Case.
 */
const migrateHelpCategoryCase = (sqlite: InstanceType<typeof Database>) => {
  sqlite.exec(`
    UPDATE help_questions SET category =
      CASE
        WHEN category = 'products' THEN 'Products'
        WHEN category = 'orders' THEN 'Orders'
        WHEN category = 'pipeline' THEN 'Pipeline'
        WHEN category = 'mappings' THEN 'Mappings'
        WHEN category = 'general' THEN 'General'
        WHEN category = 'chat' THEN 'Chat'
        WHEN category = 'analytics' THEN 'Analytics'
        ELSE category
      END
  `);
};

const migrateProductDraftsTags = (sqlite: InstanceType<typeof Database>) => {
  const cols = sqlite.prepare(`PRAGMA table_info(product_drafts)`).all() as any[];
  const colNames = new Set(cols.map((c: any) => c.name));

  if (!colNames.has('tags')) {
    sqlite.exec(`ALTER TABLE product_drafts ADD COLUMN tags TEXT`);
  }
};

const migrateNotificationLog = (sqlite: InstanceType<typeof Database>) => {
  const cols = sqlite.prepare(`PRAGMA table_info(notification_log)`).all() as any[];
  const colNames = new Set(cols.map((c: any) => c.name));

  if (!colNames.has('topic')) {
    sqlite.exec(`ALTER TABLE notification_log ADD COLUMN topic TEXT`);
  }
  if (!colNames.has('processed_at')) {
    sqlite.exec(`ALTER TABLE notification_log ADD COLUMN processed_at INTEGER`);
  }
};

export const getDb = async () => {
  if (!dbInstance) {
    const filePath = await ensureDbPath();
    rawSqlite = new Database(filePath);
    initTables(rawSqlite);
    initExtraTables(rawSqlite);
    migrateProductMappings(rawSqlite);
    migrateProductNotes(rawSqlite);
    migrateProductDraftsEbay(rawSqlite);
    migrateHelpQuestions(rawSqlite);
    migrateHelpCategoryCase(rawSqlite);
    migrateProductDraftsTags(rawSqlite);
    migrateNotificationLog(rawSqlite);
    await seedDefaultMappings(rawSqlite);
    seedHelpContent(rawSqlite);
    seedGettingStartedContent(rawSqlite);
    seedDefaultSettings(rawSqlite);
    dbInstance = drizzle(rawSqlite, { schema });
  }

  return dbInstance;
};

/**
 * Get the raw better-sqlite3 instance for direct SQL queries.
 * Must call getDb() first to initialize.
 */
export const getRawDb = async (): Promise<InstanceType<typeof Database>> => {
  if (!rawSqlite) {
    await getDb(); // Initialize
  }
  return rawSqlite!;
};
