import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as schema from './schema.js';

const DB_DIR = path.join(os.homedir(), '.clawdbot');
const DB_PATH = path.join(DB_DIR, 'ebaysync.db');

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

export const getDb = async () => {
  if (!dbInstance) {
    const filePath = await ensureDbPath();
    rawSqlite = new Database(filePath);
    initTables(rawSqlite);
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
