import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const productMappings = sqliteTable('product_mappings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shopifyProductId: text('shopify_product_id').notNull(),
  ebayListingId: text('ebay_listing_id').notNull(),
  ebayInventoryItemId: text('ebay_inventory_item_id'),
  status: text('status').default('active'),
  originalPrice: real('original_price'),               // Track original price for price drops
  shopifyTitle: text('shopify_title'),                 // Cached Shopify product title
  shopifyPrice: real('shopify_price'),                 // Cached Shopify price
  shopifySku: text('shopify_sku'),                     // Cached Shopify SKU
  lastRepublishedAt: integer('last_republished_at', { mode: 'timestamp' }),
  promotedAt: integer('promoted_at', { mode: 'timestamp' }),
  adRate: real('ad_rate'),                              // Promoted listings ad rate %
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const productPipelineStatus = sqliteTable('product_pipeline_status', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shopifyProductId: text('shopify_product_id').notNull().unique(),
  aiDescriptionGenerated: integer('ai_description_generated', { mode: 'boolean' }).default(false),
  aiDescription: text('ai_description'),
  aiCategoryId: text('ai_category_id'),
  imagesProcessed: integer('images_processed', { mode: 'boolean' }).default(false),
  imagesProcessedCount: integer('images_processed_count').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const pipelineJobs = sqliteTable('pipeline_jobs', {
  id: text('id').primaryKey(),
  shopifyProductId: text('shopify_product_id').notNull(),
  shopifyTitle: text('shopify_title'),
  status: text('status').default('queued'),
  currentStep: text('current_step'),
  stepsJson: text('steps_json'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  error: text('error'),
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

export const styleshootWatchLog = sqliteTable('styleshoot_watch_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  folderName: text('folder_name').notNull().unique(),
  folderPath: text('folder_path').notNull(),
  presetName: text('preset_name'),
  parsedProductName: text('parsed_product_name'),
  parsedSerialSuffix: text('parsed_serial_suffix'),
  shopifyProductId: text('shopify_product_id'),
  shopifyProductTitle: text('shopify_product_title'),
  matchConfidence: text('match_confidence'),
  imageCount: integer('image_count').default(0),
  status: text('status').default('detected'),
  error: text('error'),
  detectedAt: integer('detected_at', { mode: 'timestamp' }).notNull(),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
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
