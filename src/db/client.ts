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
      message TEXT NOT NULL,
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
  ];

  for (const [colName, sql] of migrations) {
    if (!colNames.has(colName)) {
      sqlite.exec(sql);
    }
  }
};

export const getDb = async () => {
  if (!dbInstance) {
    const filePath = await ensureDbPath();
    rawSqlite = new Database(filePath);
    initTables(rawSqlite);
    migrateProductMappings(rawSqlite);
    initExtraTables(rawSqlite);
    await seedDefaultMappings(rawSqlite);
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
