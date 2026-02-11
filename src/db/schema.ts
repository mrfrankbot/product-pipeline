import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const productMappings = sqliteTable('product_mappings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shopifyProductId: text('shopify_product_id').notNull(),
  ebayListingId: text('ebay_listing_id').notNull(),
  ebayInventoryItemId: text('ebay_inventory_item_id'),
  status: text('status').default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const orderMappings = sqliteTable('order_mappings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ebayOrderId: text('ebay_order_id').notNull().unique(),
  shopifyOrderId: text('shopify_order_id').notNull(),
  shopifyOrderName: text('shopify_order_name'),
  status: text('status').default('synced'),
  syncedAt: integer('synced_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const syncLog = sqliteTable('sync_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  direction: text('direction').notNull(), // ebay_to_shopify, shopify_to_ebay
  entityType: text('entity_type').notNull(), // order, product, inventory
  entityId: text('entity_id').notNull(),
  status: text('status').notNull(), // success, failed
  detail: text('detail'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const authTokens = sqliteTable('auth_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  platform: text('platform').notNull().unique(), // shopify, ebay
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  scope: text('scope'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const fieldMappings = sqliteTable('field_mappings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mappingType: text('mapping_type').notNull(), // 'category', 'condition', 'field', 'inventory_location'
  sourceValue: text('source_value'), // Shopify value
  targetValue: text('target_value').notNull(), // eBay value
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default("datetime('now')"),
  updatedAt: text('updated_at').default("datetime('now')"),
});
