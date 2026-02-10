# Codex Task: Pivot to Embedded Shopify App with Web Server

## Context
This project (`~/projects/ebay-sync-app/`) is a Shopify ↔ eBay sync tool. It currently has a working CLI with:
- Shopify API client (products, orders, inventory)
- eBay API client (inventory, fulfillment, auth, browse, trading)
- Sync engines (product-sync, order-sync, inventory-sync, price-sync, fulfillment-sync, mapper)
- SQLite database (better-sqlite3) with product_mappings, order_mappings, sync_log tables
- Credentials loader from `~/.clawdbot/credentials/`

## Task
Convert this from a CLI-only tool to an **Express web server** that can:
1. Receive eBay Platform Notifications (push-based, near-instant order import)
2. Receive Shopify webhooks (product/inventory/fulfillment updates)
3. Serve an embedded Shopify admin UI (App Bridge + Polaris)
4. Still keep the CLI for debugging

## What to Build

### 1. Express Server (`src/server/index.ts`)
- Express app listening on `PORT` env var (default 3000)
- CORS configured for Shopify admin embed
- JSON body parsing + raw body for webhook verification
- Mount all route groups
- Initialize DB on startup
- Start background sync scheduler (fallback polling every 5 min)

### 2. eBay Notification Receiver (`src/server/routes/ebay-notifications.ts`)
- POST `/webhooks/ebay/notifications`
- Parse XML body (use `xml2js`)
- Verify eBay notification signature (X-EBAY-API-SIGNATURE header)
- Handle notification types:
  - `FixedPriceTransaction` → trigger order-sync for that order
  - `AuctionCheckoutComplete` → trigger order-sync
  - `ItemSold` → trigger order-sync
- Log all notifications to `notification_log` table
- Return 200 immediately (process async)

### 3. Shopify Webhook Receiver (`src/server/routes/shopify-webhooks.ts`)
- POST `/webhooks/shopify/:topic`
- Verify HMAC signature using Shopify app secret
- Handle topics:
  - `products/update` → trigger price-sync + inventory-sync for that product
  - `products/create` → trigger product-sync (auto-list on eBay)
  - `products/delete` → remove eBay listing
  - `orders/fulfilled` → trigger fulfillment-sync
  - `inventory_levels/update` → trigger inventory-sync
- Log to `webhook_log` table

### 4. REST API for Frontend (`src/server/routes/api.ts`)
- GET `/api/status` — sync status (last sync times, counts, errors)
- GET `/api/listings` — paginated listing table (product + eBay status)
- GET `/api/orders` — recent imported orders
- GET `/api/logs` — sync log entries
- GET `/api/settings` — current settings
- PUT `/api/settings` — update settings
- POST `/api/sync/trigger` — manually trigger a full sync
- All routes require Shopify session verification

### 5. Shopify Auth Routes (`src/server/routes/shopify-auth.ts`)
- GET `/auth` — Start OAuth flow
- GET `/auth/callback` — Handle OAuth callback, store session
- Use `@shopify/shopify-api` library (already installed)

### 6. Database Schema Updates (`src/db/schema.ts`)
Add to existing schema:
```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,  -- 'ebay' or 'shopify'
  topic TEXT NOT NULL,
  payload TEXT NOT NULL,
  processedAt TEXT,
  status TEXT DEFAULT 'received',  -- received, processed, error
  error TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);
```

Default settings to insert:
- `sync_price`: `true`
- `sync_inventory`: `true`
- `auto_list`: `false`
- `sync_interval_minutes`: `5`
- `ebay_notification_url`: ``
- `item_location`: `305 W 700 S, Salt Lake City, UT 84101`

### 7. eBay Notification Subscription (`src/ebay/notifications.ts`)
- `subscribeToNotifications(notificationUrl: string)` — Call eBay SetNotificationPreferences API
- Subscribe to: FixedPriceTransaction, AuctionCheckoutComplete, ItemSold
- `getNotificationPreferences()` — Check current subscriptions
- `unsubscribeFromNotifications()` — Remove subscriptions

### 8. Shopify Webhook Registration (`src/shopify/webhooks.ts`)
New file:
- `registerWebhooks(shopDomain: string, accessToken: string, appUrl: string)` — Register all needed webhooks via Shopify API
- `listWebhooks()` — List current webhook subscriptions
- `deleteWebhook(id)` — Remove a webhook

### 9. Frontend — Embedded Shopify App
Use Vite + React + `@shopify/polaris` + `@shopify/app-bridge-react`.

Create `src/web/`:
- `App.tsx` — AppBridgeProvider + NavigationMenu + Routes
- `pages/Dashboard.tsx` — Overview: sync status cards, recent orders, recent errors
- `pages/Listings.tsx` — DataTable of products with eBay listing status (Active/Missing/Inactive)
- `pages/Orders.tsx` — DataTable of imported orders (date, Shopify #, eBay ID, customer, total)
- `pages/Settings.tsx` — Toggle switches for sync_price, sync_inventory, auto_list, sync interval
- `pages/Logs.tsx` — Filterable log table

### 10. Package.json Updates
Add dependencies:
```json
{
  "express": "^4.21.0",
  "xml2js": "^0.6.2",
  "@shopify/app-bridge-react": "^4.1.0",
  "@shopify/polaris": "^13.0.0",
  "react": "^18.3.0",
  "react-dom": "^18.3.0",
  "react-router-dom": "^6.26.0",
  "vite": "^5.4.0",
  "@vitejs/plugin-react": "^4.3.0"
}
```

Add devDependencies:
```json
{
  "@types/express": "^4.17.0",
  "@types/xml2js": "^0.4.0",
  "@types/react": "^18.3.0",
  "@types/react-dom": "^18.3.0"
}
```

Update scripts:
```json
{
  "build": "tsc && vite build",
  "dev": "tsx src/server/index.ts",
  "start": "node dist/server/index.js",
  "build:web": "vite build",
  "cli": "tsx src/cli/index.ts"
}
```

### 11. Vite Config (`vite.config.ts`)
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/web',
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
    },
  },
});
```

### 12. Background Sync Scheduler
In `src/server/index.ts`, start a setInterval that runs full sync every N minutes (from settings).
This is the fallback in case webhooks/notifications miss something.
```typescript
setInterval(async () => {
  const interval = getSetting('sync_interval_minutes') || 5;
  await runFullSync();
}, intervalMs);
```

## Important Constraints
- **Keep all existing sync code** — don't rewrite `src/sync/*`, `src/ebay/*`, `src/shopify/*`
- **Keep SQLite** — don't switch to Postgres. Use the existing better-sqlite3 setup.
- **Keep CLI working** — just add `"cli"` script to package.json
- **Keep credentials loader** — existing `src/config/credentials.ts` still works for local dev
- **Express, not Fastify** — simpler, more compatible with Shopify libraries
- **The server must serve the built Vite frontend** from `dist/web/` as static files

## File Structure After
```
src/
├── server/           # NEW
│   ├── index.ts
│   └── routes/
│       ├── api.ts
│       ├── ebay-notifications.ts
│       ├── shopify-auth.ts
│       ├── shopify-webhooks.ts
│       └── health.ts
├── web/              # NEW
│   ├── index.html
│   ├── App.tsx
│   ├── main.tsx
│   └── pages/
│       ├── Dashboard.tsx
│       ├── Listings.tsx
│       ├── Orders.tsx
│       ├── Settings.tsx
│       └── Logs.tsx
├── cli/              # EXISTING (kept)
├── sync/             # EXISTING (kept)
├── ebay/             # EXISTING (kept) + notifications.ts
├── shopify/          # EXISTING (kept) + webhooks.ts
├── db/               # EXISTING (extended)
├── config/           # EXISTING (kept)
└── utils/            # EXISTING (kept)
```

## Verify
After building, the following must work:
1. `npm run dev` starts Express on port 3000
2. `GET /health` returns `{ status: "ok" }`
3. `POST /webhooks/ebay/notifications` accepts XML, logs to DB, returns 200
4. `POST /webhooks/shopify/products-update` accepts JSON, logs to DB, returns 200
5. `GET /api/status` returns sync status JSON
6. `GET /` serves the Vite-built React app
7. `npm run cli -- products list` still works
8. TypeScript compiles clean (`npm run build`)
