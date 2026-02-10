# Architecture v2 — Embedded Shopify App + eBay Push Notifications

## Why the Pivot
v1 was CLI-only with polling. Chris wants:
1. **Near-instant order import** (like Marketplace Connect / Codisto)
2. **Embedded app** inside Shopify admin (dashboard, settings, status)

## What Changes
- **Add**: Express web server, Shopify App Bridge embedded UI, eBay Platform Notifications
- **Keep**: All sync engines (`src/sync/*`), eBay API modules (`src/ebay/*`), Shopify API modules (`src/shopify/*`), DB schema, credentials loader
- **Retire**: CLI as primary interface (keep as debug/admin tool)

## New Architecture

```
ebay-sync-app/
├── src/
│   ├── server/                    # NEW — Web server
│   │   ├── index.ts               # Express app entry point
│   │   ├── routes/
│   │   │   ├── shopify-auth.ts    # Shopify OAuth install/callback
│   │   │   ├── shopify-webhooks.ts # Shopify webhooks (product/inventory updates)
│   │   │   ├── ebay-notifications.ts # eBay Platform Notifications receiver
│   │   │   ├── api.ts             # REST API for frontend (status, settings, logs)
│   │   │   └── health.ts         # Health check endpoint
│   │   └── middleware/
│   │       ├── auth.ts            # Shopify session/HMAC verification
│   │       └── ebay-verify.ts     # eBay notification signature verification
│   ├── web/                       # NEW — Embedded UI (React)
│   │   ├── App.tsx                # Main app with App Bridge
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx      # Sync status, recent activity
│   │   │   ├── Listings.tsx       # Product listing management
│   │   │   ├── Orders.tsx         # Order import log
│   │   │   ├── Settings.tsx       # Sync settings, credentials
│   │   │   └── Logs.tsx           # Sync history/errors
│   │   └── components/
│   │       ├── SyncStatus.tsx     # Real-time sync indicator
│   │       └── ListingTable.tsx   # Product/listing table
│   ├── sync/                      # KEPT — Core sync engines
│   │   ├── product-sync.ts
│   │   ├── order-sync.ts
│   │   ├── inventory-sync.ts
│   │   ├── price-sync.ts
│   │   ├── fulfillment-sync.ts
│   │   └── mapper.ts
│   ├── ebay/                      # KEPT — eBay API modules
│   │   ├── client.ts
│   │   ├── auth.ts
│   │   ├── inventory.ts
│   │   ├── fulfillment.ts
│   │   ├── browse.ts
│   │   ├── trading.ts
│   │   ├── token-manager.ts
│   │   └── notifications.ts      # NEW — Subscribe/manage Platform Notifications
│   ├── shopify/                   # KEPT — Shopify API modules
│   │   ├── client.ts
│   │   ├── products.ts
│   │   ├── orders.ts
│   │   └── inventory.ts
│   ├── db/                        # KEPT + extended
│   │   ├── schema.ts             # Add: settings table, notification_log table
│   │   ├── client.ts
│   │   └── migrations/
│   ├── config/
│   │   └── credentials.ts        # KEPT
│   ├── cli/                       # KEPT as debug tool
│   │   └── index.ts              # Simplified — points to server for most ops
│   └── utils/
│       ├── logger.ts
│       └── retry.ts
├── package.json
├── tsconfig.json
├── vite.config.ts                 # NEW — Frontend build
└── Dockerfile                     # NEW — Replit deployment
```

## Event-Driven Order Flow (Near-Instant)

### eBay → Shopify (Order Import)
```
eBay sale happens
    → eBay Platform Notification (POST to our server)
    → /webhooks/ebay/order receives notification
    → Verify signature
    → order-sync.ts creates Shopify order
    → Save to DB (dedup)
    → ~2-5 seconds total
```

### Shopify → eBay (Inventory/Price Sync)
```
Shopify product updated
    → Shopify webhook (POST to our server)
    → /webhooks/shopify/products-update
    → inventory-sync.ts updates eBay quantity
    → price-sync.ts updates eBay price
    → ~2-5 seconds total
```

### Shopify → eBay (Fulfillment)
```
Shopify order shipped
    → Shopify webhook (orders/fulfilled)
    → /webhooks/shopify/orders-fulfilled
    → fulfillment-sync.ts marks eBay order shipped
```

## eBay Platform Notifications Setup
1. Register notification URL: `https://<app-url>/webhooks/ebay/notifications`
2. Subscribe to events:
   - `AuctionCheckoutComplete` — New order/payment
   - `FixedPriceTransaction` — Buy It Now purchase
   - `ItemSold` — Item sold
   - `BestOffer` — Best offer accepted
3. eBay sends XML POST with digital signature
4. We verify signature, parse, and trigger sync

## Shopify Webhooks
Subscribe via API on app install:
- `products/update` → price/inventory sync to eBay
- `products/create` → auto-list on eBay
- `products/delete` → remove from eBay
- `orders/fulfilled` → mark shipped on eBay
- `inventory_levels/update` → inventory sync to eBay

## Embedded App UI
- Uses Shopify App Bridge + Polaris (Shopify's React component library)
- Renders inside Shopify admin iframe
- Pages: Dashboard, Listings, Orders, Settings, Logs
- No separate login — uses Shopify session

## Database Changes
Add tables:
- `settings` — key/value store for sync config (auto_list, sync_price, sync_inventory, etc.)
- `notification_log` — eBay notification history for debugging
- `webhook_log` — Shopify webhook history

## Deployment
- **Platform**: Replit (same as TradeInManager)
- **URL**: TBD (e.g., ebay-sync.replit.app)
- **Process**: Express server, always-on
- **DB**: SQLite file on Replit persistent storage

## Key Dependencies (New)
- `express` — Web server
- `@shopify/shopify-app-express` — Shopify app middleware
- `@shopify/app-bridge-react` — Embedded UI framework
- `@shopify/polaris` — UI components
- `vite` — Frontend bundler
- `react` + `react-dom` — UI
- `xml2js` — Parse eBay XML notifications

## Migration Plan
1. Add web server alongside existing CLI
2. Move from file-based credentials to DB-stored (for Replit)
3. Register eBay Platform Notifications
4. Register Shopify webhooks on app install
5. Build embedded UI
6. Deploy to Replit
7. Test with real orders
8. Uninstall Marketplace Connect
