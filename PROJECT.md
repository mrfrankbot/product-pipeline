# ProductPipeline — PROJECT.md

> **Last updated: 2026-02-23. Any agent working on this project MUST update this file before finishing.**

## 1. Project Overview

**ProductPipeline** (formerly "ebay-sync-app" / "Product Bridge") is a full-featured listing automation platform for **Pictureline's UsedCameraGear.com** store. It replaces Marketplace Connect (Codisto) for Shopify ↔ eBay integration.

**What it does:**
- Watches a StyleShoots network drive for new product photos → auto-uploads to Shopify
- Generates AI product descriptions via OpenAI GPT
- Processes product images (background removal, templates) via self-hosted service or PhotoRoom API
- Syncs products, inventory, prices, and orders between Shopify and eBay
- Provides a web dashboard for review, approval, and management
- Integrates TradeInManager condition data into listings
- Draft/staging system with review queue before publishing

**Business context:** Pictureline photographs used camera gear on a StyleShoots machine. Products flow from Lightspeed POS → Shopify → need AI descriptions + processed photos → eBay listings. This app automates that entire pipeline.

**eBay seller:** usedcam-0 (https://www.ebay.com/usr/usedcam-0)
**Shopify store:** usedcameragear.myshopify.com

## 2. Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Server** | Express 5 + TypeScript (ESM) |
| **Frontend** | React 19 + Vite 7, Shopify Polaris, TailwindCSS 4, Zustand, React Query |
| **Database** | SQLite via better-sqlite3 + Drizzle ORM |
| **AI** | OpenAI API (GPT for descriptions, category suggestions) |
| **Image Processing** | Self-hosted Python service (FastAPI) OR PhotoRoom API (factory pattern) |
| **CLI** | Commander.js (`ebaysync` binary) |
| **Deployment** | Railway |

### Directory Structure

```
src/
├── cli/            # CLI commands (ebaysync)
├── config/         # Credential loading (~/.clawdbot/credentials/)
├── db/             # SQLite database + Drizzle schema
├── ebay/           # eBay API clients (REST: fulfillment, inventory, browse, trading)
├── server/         # Express server + routes + middleware
│   ├── routes/     # API endpoints (15+ route modules)
│   ├── middleware/  # Auth (API key + rate limiting)
│   └── capabilities.ts  # Auto-discovery registry for chat + UI
├── services/       # Business logic services
│   ├── image-service-factory.ts  # Factory: self-hosted vs PhotoRoom
│   ├── local-photoroom.ts        # Self-hosted image service client
│   ├── photoroom.ts              # PhotoRoom API client
│   ├── draft-service.ts          # Draft/staging/approval workflow
│   ├── tim-service.ts            # TradeInManager API client
│   ├── tim-matching.ts           # Match TIM items to Shopify products
│   ├── tim-tagging.ts            # Auto-tag products with TIM conditions
│   ├── photo-templates.ts        # Photo processing templates
│   └── image-processor.ts        # Image processing orchestration
├── shopify/        # Shopify API (GraphQL + REST)
├── sync/           # Sync engines (orders, products, inventory, prices, fulfillment)
│   ├── auto-listing-pipeline.ts  # Main pipeline: AI desc + images + eBay category
│   ├── category-mapper.ts        # Shopify → eBay category mapping
│   ├── listing-manager.ts        # eBay listing CRUD
│   └── pipeline-status.ts        # Job tracking
├── utils/          # Logger, retry with backoff
├── watcher/        # StyleShoots folder watcher (chokidar)
│   ├── index.ts         # Main watcher loop
│   ├── folder-parser.ts # Parse folder names for product info
│   ├── stabilizer.ts    # Wait for folder to stop changing (30s)
│   ├── shopify-matcher.ts # Fuzzy match folders → Shopify products
│   ├── shopify-uploader.ts # Upload images to Shopify
│   ├── drive-search.ts  # Search StyleShoots drive for product photos
│   └── watcher-db.ts    # Watch log persistence
└── web/            # React frontend
    ├── pages/      # Dashboard, Pipeline, ReviewQueue, ReviewDetail, Listings,
    │               # ShopifyProducts, EbayOrders, Orders, ImageProcessor,
    │               # CategoryMapping, Analytics, Settings, Help*, Feature*
    ├── components/ # PhotoGallery, ChatWidget, TemplateManager, etc.
    └── store/      # Zustand state management
```

### Self-Hosted Image Service

Located at `~/projects/product-pipeline/image-service/` — a separate Python FastAPI app:
- Background removal (rembg or similar)
- Image processing (resize, pad, shadow)
- Template rendering
- Docker-based deployment
- Concurrency-controlled with semaphores
- Health/metrics endpoints

### Database Schema (SQLite)

| Table | Purpose |
|-------|---------|
| `auth_tokens` | OAuth tokens for Shopify + eBay |
| `product_mappings` | Shopify ↔ eBay listing links, cached prices/SKUs |
| `order_mappings` | eBay → Shopify order dedup |
| `sync_log` | Audit trail of all sync operations |
| `product_pipeline_status` | AI description + image processing status per product |
| `pipeline_jobs` | Pipeline job queue with step tracking |
| `product_drafts` | Draft/staging system for review before publish |
| `auto_publish_settings` | Per-product-type auto-publish rules |
| `styleshoot_watch_log` | Folder watcher activity log |
| `field_mappings` | Category, condition, field mappings (Shopify ↔ eBay) |
| `photo_templates` | Saved image processing parameter templates |
| `image_processing_log` | Per-image processing status and results |

DB location: `src/db/product-pipeline.db` (dev), `~/.clawdbot/ebaysync.db` (production)

## 3. Current State

### Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| **StyleShoots Watcher** | ✅ Working | Watches `/Volumes/StyleShootsDrive/UsedCameraGear/`, auto-uploads to Shopify |
| **AI Descriptions** | ✅ Working | OpenAI GPT generates product descriptions with TIM condition data |
| **Image Processing** | ✅ Working | Factory pattern: self-hosted (preferred) or PhotoRoom fallback |
| **Draft/Review System** | ✅ Working | Full approval workflow with review queue UI |
| **eBay Order Import** | ✅ Working | eBay → Shopify with dedup (DB + tag-based) |
| **Product Sync (→ eBay)** | ✅ Working | Shopify → eBay listing creation |
| **Draft → eBay Listing** | ✅ Working | Approve draft → create live eBay listing from review queue |
| **Inventory Sync** | ✅ Working | Shopify → eBay quantity sync |
| **Price Sync** | ✅ Working | Shopify → eBay price sync |
| **Fulfillment Sync** | ✅ Working | Shopify → eBay shipping updates |
| **TIM Integration** | ✅ Working | Fetches condition data, auto-tags Shopify products |
| **Photo Templates** | ✅ Working | Saveable processing presets per category |
| **Chat Widget** | ✅ Working | AI-powered help chat with capability awareness |
| **Category Mapping UI** | ✅ Working | StyleShoots preset → Shopify/eBay category mapping |
| **Manual Pipeline Trigger** | ✅ Working | Drive search + draft product support |
| **Web Dashboard** | ✅ Working | Full React UI with Polaris components |
| **Help Center** | ✅ Working | Built-in help system with admin |
| **Feature Requests** | ✅ Working | User-facing feature request/voting system |
| **eBay Notifications** | ✅ Implemented | Webhook endpoint for eBay platform notifications |
| **Analytics** | ✅ Basic | Recharts-based analytics page |

### Recent Work (git log)

1. **Self-hosted image processing** — Factory pattern for local vs PhotoRoom (latest)
2. **Manual pipeline trigger** — Drive search + draft product support
3. **TIM condition tags** — Auto-tag Shopify products with trade-in condition data
4. **TIM integration** — Fetch condition data from trades.pictureline.com
5. **Review queue redesign** — Full-page Shopify-style review detail
6. **Product dedup fix** — 105 duplicate products from Shopify API
7. **eBay Orders import** — Browse + import eBay orders
8. **Product Notes** — Notes feature for products
9. **Pipeline review modal** — Inline approve description, photos, eBay listing

### Known Issues

- CORS still references old Railway domain (`ebay-sync-app-production.up.railway.app`)
- Logs page disabled (`.tsx.bak`)
- GitHub repo not yet renamed from original name

## 4. Key Integrations

### Shopify API
- **Client:** `@shopify/shopify-api` (GraphQL + REST)
- **Store:** usedcameragear.myshopify.com
- **Auth:** OAuth flow via `/auth/shopify` routes, tokens stored in DB
- **Operations:** Products CRUD, image upload, order creation, inventory management, metafields
- **Webhooks:** Product create/update/delete at `/webhooks/shopify`

### eBay API
- **Auth:** OAuth2 with token auto-refresh (`token-manager.ts`)
- **APIs used:** Fulfillment (orders), Inventory (items + offers), Browse (search), Trading (account/policies)
- **Seller:** usedcam-0
- **Webhooks:** Platform notifications at `/webhooks/ebay`

### Image Processing
- **Primary:** Self-hosted FastAPI service (`image-service/`) — background removal, processing, templates
  - URL configurable via `IMAGE_SERVICE_URL` (default: `http://localhost:8100`)
  - Docker-based, concurrency-controlled
- **Fallback:** PhotoRoom API (requires `PHOTOROOM_API_KEY`)
- **Selection:** `IMAGE_PROCESSOR` env var: `self-hosted` | `photoroom` | `auto` (default)
- **Factory:** `image-service-factory.ts` handles provider selection with health checks

### StyleShoots Drive
- **Watch path:** `/Volumes/StyleShootsDrive/UsedCameraGear/`
- **Flow:** Folder appears → stabilize 30s → parse folder name → fuzzy match Shopify product → upload images
- **Preset folders** map to product categories (e.g. "Trade-Ins - Small Lenses")
- **SMB mount** with reconnect handling

### TradeInManager (TIM)
- **URL:** https://trades.pictureline.com
- **Auth:** Session-based login (mrfrankbot@gmail.com, password in `~/.clawdbot/credentials/tradeinmanager.txt`)
- **Data:** Condition grades, grader notes, serial numbers, pricing
- **Matching:** SKU-based matching between TIM items and Shopify products
- **Auto-tagging:** Applies condition tags to Shopify products

### OpenAI
- **Purpose:** Generate product descriptions, suggest eBay categories
- **Model:** GPT (via `openai` npm package)
- **Context:** Includes product title, vendor, TIM condition data, product notes

## 5. Configuration & Environment

### Credentials (file-based)

All stored in `~/.clawdbot/credentials/`:

| File | Contents |
|------|----------|
| `ebay-api.txt` | App ID, Dev ID, Cert ID, RuName |
| `shopify-usedcameragear-api.txt` | Client ID, Client Secret |
| `tradeinmanager.txt` | TIM login password |

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | Server port | `3000` |
| `OPENAI_API_KEY` | OpenAI API for AI descriptions | Required |
| `PHOTOROOM_API_KEY` | PhotoRoom API key (fallback image processor) | Optional |
| `IMAGE_PROCESSOR` / `IMAGE_SERVICE` | Image provider: `self-hosted`, `photoroom`, `auto` | `auto` |
| `IMAGE_SERVICE_URL` | Self-hosted image service URL | `http://localhost:8100` |
| `EBAY_APP_ID` | eBay App ID (overrides credential file) | From file |
| `EBAY_DEV_ID` | eBay Dev ID | From file |
| `EBAY_CERT_ID` | eBay Cert ID | From file |
| `EBAY_RU_NAME` | eBay Redirect URI Name | From file |
| `SHOPIFY_CLIENT_ID` | Shopify Client ID | From file |
| `SHOPIFY_CLIENT_SECRET` | Shopify Client Secret | From file |
| `SAFETY_MODE` | Order sync safety: `safe` (rate-limited) or `off` | `safe` |

### Deployment (Railway)

- Server runs `npm run build && npm start`
- Build: `tsc` (server) + `vite build` (frontend)
- Static frontend served by Express from `dist/web/`
- Domain: `ebay-sync-app-production.up.railway.app` (needs rename)
- SQLite DB persists on Railway volume

## 6. How to Continue

### Local Dev Setup

```bash
cd ~/projects/product-pipeline
npm install

# Start dev server (auto-reloads)
npm run dev          # Server at http://localhost:3000

# Or run server + web separately:
npm run dev:server   # Express API
npm run dev:web      # Vite dev server (HMR)

# For image processing, also start the image service:
cd image-service
docker compose up    # or: python server.py
```

### CLI Usage

```bash
npm run cli -- status              # Dashboard
npm run cli -- orders sync         # Sync eBay orders
npm run cli -- products sync       # Sync products to eBay
npm run cli -- inventory sync      # Sync inventory
```

### Deploy

```bash
# Railway auto-deploys from git push
git push origin main

# Manual: Railway CLI
railway up
```

### Adding New Features

1. Add API route in `src/server/routes/`
2. Register capability in `src/server/capabilities.ts` (auto-surfaces in chat + UI)
3. Add frontend page in `src/web/pages/`, route in `App.tsx`
4. Add nav item in `AppNavigation.tsx`
5. Update DB schema in `src/db/schema.ts` if needed

### Testing

```bash
npm test              # vitest run
npm run test:watch    # vitest watch mode
```

Test files: `src/services/__tests__/`

## 7. Decision Log

| Decision | Rationale |
|----------|-----------|
| **SQLite over Postgres** | Single-user app, Railway volume support, zero-config, fast |
| **Drizzle ORM** | Type-safe, lightweight, great SQLite support |
| **Express 5** | Familiar, async route support, serves both API + static frontend |
| **Factory pattern for images** | Self-hosted service saves PhotoRoom API costs; factory enables seamless fallback |
| **File-based credentials** | Predates env vars; supports both now (env overrides files) |
| **Draft/staging system** | Chris wanted to review AI descriptions before publishing to Shopify |
| **Capability registry** | Chat widget and UI auto-discover features; no manual prompt maintenance |
| **Chokidar watcher** | Reliable cross-platform file watching with debounce/stabilization |
| **Rename from "ebay-sync-app"** | Scope grew far beyond eBay sync; now a full product pipeline |
| **TIM integration** | Condition data from trade-ins improves AI description quality |

## 8. Next Steps

**Prioritized remaining work:**

1. **Rename Railway domain** — Still using `ebay-sync-app-production.up.railway.app`
2. **Rename GitHub repo** — Match new ProductPipeline name
3. **Re-enable Logs page** — Currently `.tsx.bak`, needs fix
4. **eBay listing creation** — Full automated Shopify → eBay listing push (partially implemented in `listing-manager.ts`)
5. **Image service deployment** — Deploy self-hosted image service to Railway alongside main app
6. **Auto-pipeline trigger** — Automatically run pipeline when StyleShoots watcher detects + uploads photos
7. **Batch operations** — Process multiple products through pipeline at once
8. **eBay category mapping improvements** — Better auto-suggestion, more category coverage
9. **Webhook reliability** — Retry/queue for failed Shopify/eBay webhooks
10. **Auth hardening** — Current API key auth is basic; consider proper session auth for web UI

## Recent Changes

### 2026-02-25: End-to-End UI Fixes — Voting, Orders Filters, Sync Status
Improved end-to-end functionality to eliminate dead interactions and mismatches:
- **Feature Requests voting**: added vote tracking and API support; UI now shows vote counts and allows one vote per browser.
- **Orders page accuracy**: orders API now supports search/status/date filters and surfaces totals via eBay order data; UI status filters align with actual sync states.
- **Sync reliability**: order sync trigger now accepts body-provided dates, inventory status can be queried via GET, and background sync uses explicit `confirm=true`.

### 2026-02-24: Help Center — Seed Articles for All Shipped Features

Added a dedicated seed script for Help Center articles covering every shipped feature.

**What changed:**
- **`src/server/seeds/help-articles.ts`** (new): Standalone seed module with 16 articles across 5 categories (Getting Started, Products, eBay, Pipeline, Settings). Uses `INSERT OR IGNORE` so it's safe to run on every startup.
- **`src/server/index.ts`**: Calls `seedHelpArticles(rawDb)` on startup after other seeds.
- **`AGENTS.md`**: Added "Help Documentation Rule" — agents must add a help article whenever shipping a new feature.

**Articles added:**
- Getting Started: What is ProductPipeline?, How do I get started?
- Products: Review Queue workflow, drag-and-drop photo reordering, bulk photo editing, photo editor, image processing pipeline trigger
- eBay: List a product, change eBay category (searchable dropdown), condition descriptions (auto-populated from grades), eBay order sync + safety guards
- Pipeline: Automated pipeline (StyleShoots → Shopify → eBay), AI descriptions, pipeline settings
- Settings: Connect Shopify, connect eBay, edit condition descriptions

### 2026-02-23: eBay Listing Prep Page — Full Visibility Before Listing

Redesigned the "Approve & List on eBay" flow to give full visibility and control before creating a listing.

**What changed:**
- **`src/web/pages/EbayListingPrep.tsx`** (new): Full-page eBay listing preparation view.
  - Fetches system-generated preview data on load (calls existing `preview-ebay-listing` endpoint)
  - **All fields are editable before listing:** eBay title (with 80-char limit badge), price, category ID, condition dropdown (New/Like New/Excellent/Very Good/Good/Acceptable/For Parts), item specifics as key-value pairs (add/remove), condition description, photos (reorder with ↑↓, remove), description (textarea, HTML-aware)
  - **Business policies** displayed with IDs (not editable here — managed in eBay seller account)
  - **Real eBay-style preview:** Mimics the eBay listing page layout (title, price, photo gallery with thumbnail strip, condition badge, item specifics table, description, seller info)
  - **Photo management:** Thumbnail grid with #1 marked as MAIN, reorder/remove controls
  - **Sticky sidebar** with summary of all settings + two action buttons
  - **"List on eBay"** (primary) — sends all edited values as overrides to the API
  - **"Save as Draft"** — saves title/description to draft API + stores eBay-specific overrides (category, condition, aspects, price, image order) in localStorage, keyed by draftId; restored on next visit
  - **"Reload from System"** secondary action — re-fetches system defaults, discarding manual edits
  - Returns to review detail after listing or saving
- **`src/web/pages/ReviewDetail.tsx`**: "Approve & List on eBay" button now navigates to `/review/:id/ebay-prep` (no more small modal). Removed old modal and preview mutation code.
- **`src/web/App.tsx`**: Added route `/review/:id/ebay-prep` → `<EbayListingPrep />`
- **`src/services/ebay-draft-lister.ts`**: `listDraftOnEbay()` now accepts optional `overrides: ListingOverrides` — any field supplied overrides the system-generated value. New `ListingOverrides` export type.
- **`src/server/routes/drafts.ts`**: `POST /api/drafts/:id/list-on-ebay` now accepts optional body `{ title, price, categoryId, condition, aspects, description, imageUrls }` and passes them as overrides to the service.

**Safety:** Still single product, explicit click only. No auto-publish. No batch.

### 2026-02-23: Order Sync Safety Guards

Added multiple layers of protection to prevent duplicate Shopify orders from cascading into Lightspeed POS (repeat of the 2026-02-11 incident):

- **`src/sync/order-safety.ts`** (new): Central safety module — `SAFETY_MODE` rate limiter (default `"safe"`: max 5/hr, min 10s between creations), `findDuplicateByTotalDateBuyer()` third-layer duplicate detection, custom error types.
- **`src/sync/order-sync.ts`**: Dry-run is now the default (`confirm=true` required to create real orders). Three duplicate-detection layers applied before any creation. `SyncResult` now includes `dryRun` flag and `safetyBlocks[]` array.
- **`src/server/sync-helper.ts`**: `confirm` parameter added; dry run documented as default.
- **`src/server/routes/api.ts`**: `POST /api/sync/trigger` requires `?confirm=true` for live runs.
- **`src/server/routes/ebay-orders.ts`**: Safety comments on import endpoint; new `POST /api/ebay/orders/sync-to-shopify` requires `{ confirm: true }`.
- **`src/web/pages/EbayOrders.tsx`**: Critical warning banner about Lightspeed POS downstream impact.
- **`AGENTS.md`** (new at project root): Complete rules for agents/developers working on this codebase.

### 2026-02-23: Approve Draft → Create eBay Listing Flow

Built the end-to-end "list on eBay" workflow from the draft review queue:

**Backend:**
- New service: `src/services/ebay-draft-lister.ts` — single-product eBay lister
  - Builds eBay inventory item from draft content (title, description, images) with Shopify fallback
  - Ensures Pictureline inventory location exists (idempotent)
  - Fetches business policies, maps condition/category/aspects using existing mappers
  - Creates eBay inventory item → offer → publishes → saves `product_mappings` record
  - Updates `product_drafts.status` to `'listed'`, saves `ebay_listing_id` + `ebay_offer_id`
  - Logs success/failure to `sync_log`
  - Dry-run preview mode: builds full payload without calling eBay publish
- Two new API routes in `src/server/routes/drafts.ts`:
  - `POST /api/drafts/:id/list-on-ebay` — creates live eBay listing (single product, explicit click only)
  - `POST /api/drafts/:id/preview-ebay-listing` — dry run preview of what would be sent to eBay
- DB schema: added `ebay_listing_id` and `ebay_offer_id` columns to `product_drafts` table (auto-migrated on startup)

**Frontend (`ReviewDetail.tsx`):**
- "🛍️ Approve & List on eBay" button in the Actions sidebar card
- Confirmation modal with safety warning before listing goes live
- "Preview Listing" option loads dry-run payload inline in the modal
- Shows live eBay listing badge + "View on eBay" link after success
- Pipeline Status card updated with eBay listing step (green when listed)
- `statusBadge()` handles new `'listed'` status

**Safety:** NO batch, NO auto-publish. Single product, explicit user action required.

### 2026-02-18: Product Detail Page Redesign
Redesigned `ShopifyProductDetail` in `src/web/pages/ShopifyProducts.tsx` to match ReviewDetail quality:
- **Single CTA**: "Run Pipeline" appears only in page header (removed from Quick Actions and sidebar)
- **Removed Quick Actions card**: External links moved to page `secondaryActions`
- **Status badges in title**: TIM Condition and eBay status shown as compact badges next to product title
- **Pipeline as sidebar hero**: Pipeline progress tracker is now the top sidebar card
- **Beautiful empty states**: Photos section shows a dashed drop-zone with Drive search CTA when empty
- **Conditional cards**: TIM Condition and eBay cards only render when data exists (no empty cards)
- **Consolidated Details card**: Merged product info into a single compact card, tags shown inline
- **Subtle animations**: Fade-in animation on page load
- **Consistent spacing**: `gap="400"` throughout, matching ReviewDetail patterns
- **All functionality preserved**: No features removed, only visual reorganization
