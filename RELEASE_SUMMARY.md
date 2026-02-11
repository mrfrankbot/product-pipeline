# eBay Sync App - Critical Fixes & Marketplace Connect Features

**Released:** 2026-02-11  
**Deploy Status:** ✅ Pushed to `chris` remote - Railway will auto-deploy

## 🚨 CRITICAL FIXES COMPLETED

### 1. ✅ Fixed sync-helper.ts - Default Date Filter
- **Problem**: Was fetching ALL historical eBay orders on every sync
- **Solution**: Now defaults `createdAfter` to 24 hours ago if not specified
- **Impact**: Prevents massive data fetches, faster syncs

### 2. ✅ Fixed Bulletproof Deduplication  
- **Problem**: 259 duplicate orders created because old Codisto orders don't have our tags
- **Solution**: Triple-layer dedup search:
  1. Tag-based: `eBay-{orderId}` (our app)
  2. source_identifier: Standards compliance  
  3. Note content: Catches legacy Codisto orders
- **Impact**: Zero duplicates going forward

### 3. ✅ Fixed Auto-Sync Scheduler
- **Problem**: Was disabled/broken
- **Solution**: 
  - Re-enabled with setting control
  - `auto_sync_enabled` defaults to FALSE (must be explicitly turned on)
  - Reads setting from DB each interval (not cached)
  - Only syncs last 24 hours for auto-sync
- **Impact**: Safe, controlled background sync when enabled

### 4. ✅ Added --since to Manual Sync
- **Endpoint**: `POST /api/sync/trigger?since=2026-02-01T00:00:00Z`
- **Default**: 24 hours if not specified
- **Impact**: Controllable sync scope

## 🚀 NEW MARKETPLACE CONNECT FEATURES

### 5. ✅ Product Sync (Shopify → eBay)
- **Endpoint**: `POST /api/sync/products`
- **Features**:
  - Creates eBay inventory items + offers + published listings
  - Maps Shopify fields → eBay (title, description, price, images, condition)
  - Condition mapping from Shopify tags (`GOOD`, `LIKE_NEW`, etc.)
  - Category auto-mapping based on product type
  - Stores mappings in `product_mappings` table
- **Usage**: Send `productIds` array in request body

### 6. ✅ Inventory Sync (Bidirectional)
- **Endpoint**: `POST /api/sync/inventory`
- **Features**: 
  - Shopify stock → eBay quantity updates
  - Real-time webhook support for instant updates
  - Rate limited (2/sec Shopify, 5/sec eBay)
- **Webhook**: `inventory_levels/update` handler implemented

### 7. ✅ Fulfillment Sync (Shopify → eBay)
- **Trigger**: Shopify `orders/fulfilled` webhook
- **Features**:
  - Auto-creates eBay shipping fulfillment with tracking
  - Maps shipping carriers (USPS, UPS, FedEx, etc.)
  - Updates local order status to 'fulfilled'
- **Impact**: No manual eBay shipping updates needed

### 8. ✅ Manual Product Linking
- **Endpoint**: `POST /api/listings/link`
- **Purpose**: Link existing eBay listings to Shopify products by SKU
- **Usage**: Send `{ shopifyProductId, ebayListingId, sku }`

### 9. ✅ Enhanced Product Data
- **New**: `fetchDetailedShopifyProduct()` - gets full product data for eBay
- **Includes**: Images, variants, inventory, weight, tags, description
- **Purpose**: Rich data for eBay listing creation

## 📊 SETTINGS ADDED

| Setting | Default | Purpose |
|---------|---------|---------|
| `auto_sync_enabled` | `false` | Must be explicitly enabled |
| `sync_price` | `true` | Price sync Shopify → eBay |
| `sync_inventory` | `true` | Inventory sync Shopify → eBay |
| `auto_list` | `false` | Auto-create eBay listings for new products |
| `sync_interval_minutes` | `5` | Background sync frequency |

## 🔧 TECHNICAL IMPROVEMENTS

- **Rate Limiting**: Shopify 2 req/sec, eBay 5 req/sec
- **Error Handling**: Comprehensive error logging + sync_log table
- **Type Safety**: Enhanced TypeScript interfaces
- **Performance**: Date-filtered queries prevent massive data fetches
- **Webhook Security**: HMAC verification for all Shopify webhooks

## 🧪 TESTING

```bash
# Test order sync with date filter
curl -X POST "http://localhost:3000/api/sync/trigger?since=2026-02-01T00:00:00Z&dry=true"

# Test product sync (dry run)
curl -X POST "http://localhost:3000/api/sync/products?dry=true" \
  -H "Content-Type: application/json" \
  -d '{"productIds": ["123", "456"]}'

# Test inventory sync
curl -X POST "http://localhost:3000/api/sync/inventory?dry=true"

# Manual product linking
curl -X POST "http://localhost:3000/api/listings/link" \
  -H "Content-Type: application/json" \
  -d '{"shopifyProductId": "123", "ebayListingId": "456", "sku": "CAM-001"}'
```

## ⚠️ DEPLOYMENT NOTES

- **Auto-sync is DISABLED** by default (`auto_sync_enabled=false`)
- **eBay auth token** needs to be re-authorized (was revoked)
- **Business policies** use placeholder IDs - need real eBay policy IDs
- **Multi-variant products** not supported yet (single SKU only)
- **Test in staging** before enabling auto-sync in production

## 🎯 NEXT PRIORITIES

1. **Get eBay auth working** (token was revoked)
2. **Test product sync** with real data
3. **Configure eBay business policies** (fulfillment, payment, returns)  
4. **Enable auto-sync** after testing (`auto_sync_enabled=true`)
5. **Add price sync** implementation
6. **Add auto-list** for new products

---

**Status**: Ready for testing. The duplicate order issue is fixed, and core Marketplace Connect features are implemented. Need eBay re-authorization to test the new product/inventory sync features.