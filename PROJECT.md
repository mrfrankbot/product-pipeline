# ProductPipeline — PROJECT.md

> **Any agent working on this project MUST read this file first and update it before finishing.**
> **Last updated: 2026-02-23**

## Vision & Roadmap

### The Goal
Replace Marketplace Connect (Codisto) with a fully automated product pipeline for Pictureline's used camera gear business. End-to-end: a product enters the system → gets professional photos → AI description → reviewed → listed on eBay → inventory stays in sync → sold item auto-delists.

### Original Scope (Jan 2026)
- Shopify ↔ eBay two-way sync (products, orders, inventory, prices, fulfillment)
- Web dashboard to manage it all
- Replace Codisto ($$/month, unreliable)

### What We Added
- **AI Pipeline:** GPT-generated descriptions using product data + TIM condition grades, category suggestions
- **Photo Pipeline:** StyleShoots drive watcher → auto-upload → background removal → professional templates → GCS storage
- **Self-Hosted Image Processing:** BiRefNet model to replace PhotoRoom API (cost savings)
- **Photo Editor:** Rotate/reposition/scale products, ground shadows, cutout-based editing
- **Draft/Review System:** Nothing goes live without approval. Review queue, bulk operations
- **TIM Integration:** Trade-in condition data flows into descriptions and Shopify tags
- **Real-Time Inventory Sync:** Product sold on Shopify → eBay listing auto-ends. Restocked → auto-relists
- **eBay Order Import:** Pull eBay orders into the system
- **Chat Assistant, Help Center, Feature Requests, Analytics, Full CLI**

### What's Left to Complete
1. ✅ **eBay listing creation** — COMPLETED. Draft approval flow now creates live eBay listings
2. **Verify webhook registration** — Inventory sync code is built but need to confirm Shopify webhooks are active on Railway
3. **Watch mode / polling fallback** — Continuous sync as backup to webhooks
4. **Self-hosted image fine-tuning** — Needs GPU training to match PhotoRoom quality
5. **Auto-pipeline trigger** — StyleShoots watcher should auto-kick the full pipeline, not just upload photos
6. **Photo editor testing** — Rewritten, awaiting Chris's review
7. **Domain/repo rename** — Still "ebay-sync-app" everywhere

### The End State
A product gets photographed on the StyleShoots machine. The system detects the photos, processes them, generates a description, stages a draft for review. Chris approves. It goes live on Shopify AND eBay simultaneously. When it sells on either platform, inventory updates everywhere and the listing ends on the other. Zero manual data entry. Zero Codisto.

## 1. Project Overview

**ProductPipeline** (formerly "ebay-sync-app" / "Product Bridge") is a full-featured listing automation platform for **Pictureline's UsedCameraGear.com** store. It replaces Marketplace Connect (Codisto) for Shopify ↔ eBay integration.

**What it does:**
- Watches a StyleShoots network drive for new product photos → auto-uploads to Shopify
- Generates AI product descriptions via OpenAI GPT (with retry/backoff)
- Processes product images (background removal, templates) via self-hosted service or PhotoRoom API
- Syncs products, inventory, prices, and orders between Shopify and eBay
- Provides a web dashboard for review, approval, and management
- Integrates TradeInManager condition data into listings
- Draft/staging system with review queue before publishing
- GCS-backed photo storage with signed URLs

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
| **Photo Storage** | Google Cloud Storage (`pictureline-product-photos` bucket) |
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
    ├── components/ # PhotoGallery, ChatWidget, TemplateManager, PhotoEditor, etc.
    └── store/      # Zustand state management
```

### Self-Hosted Image Service

Located at `~/projects/product-pipeline/image-service/` — a separate Python FastAPI app:
- Background removal via BiRefNet ONNX (1024×1024) — upgraded from u2net
- Image processing (resize, pad, shadow)
- Template rendering
- Docker-based deployment
- Concurrency-controlled with semaphores
- Health/metrics endpoints
- **Status:** Core complete, fine-tuning needs GPU (≥16GB VRAM)

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

## 3. Current State (Feb 2026)

### Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| **StyleShoots Watcher** | ✅ Working | Watches `/Volumes/StyleShootsDrive/UsedCameraGear/` |
| **AI Descriptions** | ✅ Working | GPT with TIM condition data, retry with backoff |
| **Image Processing** | ✅ Working | Factory pattern: self-hosted (preferred) or PhotoRoom fallback |
| **GCS Photo Storage** | ✅ Working | `pictureline-product-photos` bucket, signed URLs |
| **Draft/Review System** | ✅ Working | Full approval workflow with review queue UI |
| **Photo Editor** | 🔧 Testing | Full rewrite (raw HTML overlay), awaiting Chris's testing |
| **eBay Order Import** | ✅ Working | eBay → Shopify with dedup |
| **eBay Listing Creation** | ✅ Working | Draft approval → live eBay listing with confirmation modal |
| **Product Sync (→ eBay)** | ✅ Working | Shopify → eBay listing creation |
| **Inventory Sync** | ✅ Working | Shopify → eBay quantity sync |
| **Price Sync** | ✅ Working | Shopify → eBay price sync |
| **Fulfillment Sync** | ✅ Working | Shopify → eBay shipping updates |
| **TIM Integration** | ✅ Working | Condition data, auto-tags, AI description injection |
| **Photo Templates** | ✅ Working | Saveable processing presets per category |
| **Category Mapping UI** | ✅ Working | StyleShoots preset → Shopify/eBay category mapping |
| **Manual Pipeline Trigger** | ✅ Working | Drive search + draft product support |
| **SSE Progress Streaming** | ✅ Working | Live pipeline progress with cancel button |
| **Web Dashboard** | ✅ Working | Full React UI with Polaris components |
| **Bulk Pipeline** | ✅ Working | Select multiple products, run pipeline in bulk |
| **Chat Widget** | ✅ Working | Full-featured AI assistant with capability awareness |
| **Comprehensive CLI** | ✅ Working | All web app features accessible via CLI |
| **Help Center** | ✅ Working | Built-in help system |
| **Feature Requests** | ✅ Working | User-facing feature request/voting system |
| **Analytics** | ✅ Basic | Recharts-based analytics page |

### Deployment

| Environment | URL | Status |
|-------------|-----|--------|
| **Railway** | ebay-sync-app-production.up.railway.app | ✅ RUNNING (verified 2026-02-23) |
| **Local dev** | localhost:3000 | Standard dev setup |

**Note:** Railway domain was never renamed from `ebay-sync-app`. The `product-pipeline-production` URL doesn't exist.
**Auth:** API key via `API_KEY` env var on Railway, sent as `X-API-Key` header.
**Shopify embedded:** App runs inside Shopify admin at usedcameragear.myshopify.com, not as a standalone site.

### Git Remotes
- `origin` → `mrfrankbot/product-pipeline` (Frank's fork)
- `chris` → `chrisbachmaxwell/product-pipeline` (Chris's repo)
- Branch: `main` only (no railway branch — that's the TIM repo)

### Known Issues
- CORS references `ebay-sync-app-production.up.railway.app` (this IS the live domain, but should be renamed)
- Railway domain not yet renamed from ebay-sync-app
- GitHub repo on Chris's account not yet renamed from original name
- Logs page disabled (`.tsx.bak`)

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

### Google Cloud Storage
- **Bucket:** `pictureline-product-photos`
- **Permissions:** objectAdmin + serviceAccountTokenCreator
- **Usage:** Draft photo storage, processed images, cutout files (`_cutout.png`)
- **Auth:** GCS service account key (env var or credential file)

### Image Processing
- **Primary:** Self-hosted FastAPI service (`image-service/`) — BiRefNet ONNX background removal
  - URL configurable via `IMAGE_SERVICE_URL` (default: `http://localhost:8100`)
  - Docker-based, concurrency-controlled
- **Fallback:** PhotoRoom API (requires `PHOTOROOM_API_KEY`)
- **Selection:** `IMAGE_PROCESSOR` env var: `self-hosted` | `photoroom` | `auto` (default)
- **Factory:** `image-service-factory.ts` handles provider selection with health checks
- **Pipeline:** 4000×4000 output canvas, 400px min padding, images resized to 2000px before processing, 60s/30s/5min timeouts, 3x retry with backoff

### StyleShoots Drive
- **Watch path:** `/Volumes/StyleShootsDrive/UsedCameraGear/`
- **Flow:** Folder appears → stabilize 30s → parse folder name → fuzzy match Shopify product → upload images
- **Preset folders** map to product categories
- **SMB mount** with reconnect handling

### TradeInManager (TIM)
- **URL:** https://trades.pictureline.com
- **Auth:** Session-based login (mrfrankbot@gmail.com)
- **Data:** Condition grades, grader notes, serial numbers, pricing
- **Matching:** SKU-based matching between TIM items and Shopify products
- **Auto-tagging:** Applies `condition-{value}` tags to Shopify products

### OpenAI
- **Purpose:** Generate product descriptions, suggest eBay categories
- **Model:** GPT (via `openai` npm package)
- **Context:** Product title, vendor, TIM condition data, product notes
- **Reliability:** `withRetry()` helper with exponential backoff (commit c7c3076)

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
| `PHOTOROOM_API_KEY` | PhotoRoom API key (fallback) | Optional |
| `IMAGE_PROCESSOR` / `IMAGE_SERVICE` | Image provider: `self-hosted`, `photoroom`, `auto` | `auto` |
| `IMAGE_SERVICE_URL` | Self-hosted image service URL | `http://localhost:8100` |
| `GCS_SERVICE_ACCOUNT_KEY` | Google Cloud Storage credentials | Required for photo storage |
| `SAFETY_MODE` | Order sync safety: `safe` (rate limits + confirmation) or `normal` | `safe` |
| `EBAY_APP_ID` | eBay App ID | From file |
| `EBAY_DEV_ID` | eBay Dev ID | From file |
| `EBAY_CERT_ID` | eBay Cert ID | From file |
| `EBAY_RU_NAME` | eBay Redirect URI Name | From file |
| `SHOPIFY_CLIENT_ID` | Shopify Client ID | From file |
| `SHOPIFY_CLIENT_SECRET` | Shopify Client Secret | From file |

### Deployment (Railway)

- Server runs `npm run build && npm start`
- Build: `tsc` (server) + `vite build` (frontend)
- Static frontend served by Express from `dist/web/`
- Domain: `ebay-sync-app-production.up.railway.app` (not yet renamed)
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

## 7. Decision Log

| Decision | Rationale |
|----------|-----------|
| **SQLite over Postgres** | Single-user app, Railway volume support, zero-config, fast |
| **Drizzle ORM** | Type-safe, lightweight, great SQLite support |
| **Express 5** | Familiar, async route support, serves both API + static frontend |
| **Factory pattern for images** | Self-hosted saves PhotoRoom costs; factory enables seamless fallback |
| **GCS for photo storage** | Reliable, signed URLs, integrates with pipeline |
| **Draft/staging system** | Chris wanted to review AI descriptions before publishing |
| **Capability registry** | Chat widget and UI auto-discover features |
| **BiRefNet over u2net** | Higher quality background removal (1024×1024) |
| **Rename from "ebay-sync-app"** | Scope grew far beyond eBay sync |
| **TIM integration** | Condition data from trade-ins improves AI description quality |

## 8. Next Steps (Prioritized)

1. **Verify Railway deployment is running** — Check if app is live and functional
2. **Fix CORS domain** — Update from old `ebay-sync-app-production` domain
3. **Rename Railway domain + GitHub repo** — Match ProductPipeline name
4. **Photo editor testing** — Chris needs to test in Shopify admin
5. **eBay listing creation** — Full automated Shopify → eBay listing push
6. **Re-enable Logs page** — Currently `.tsx.bak`
7. **Image service deployment** — Deploy self-hosted service to Railway
8. **Auto-pipeline trigger** — Auto-run pipeline when StyleShoots watcher detects photos
9. **Batch operations** — Process multiple products through pipeline at once
10. **Self-hosted image fine-tuning** — Needs GPU rental (≥16GB VRAM)

## Changelog

### 2026-02-23
- **eBay Listing Creation Flow** — Added "Approve Draft → Create eBay Listing" functionality
  - New API endpoints: POST /api/drafts/:id/list-on-ebay and POST /api/drafts/:id/preview-ebay-listing
  - Enhanced ReviewDetail.tsx with "Approve & List on eBay" button and confirmation modal
  - Added eBay listing preview (dry run) functionality
  - Registered new capabilities in capabilities registry
  - Added product_notes field to database schema
  - Safety: Single product, explicit click only - no batch operations or auto-publish
- **CRITICAL: Order Sync Safety Guards** — After 2026-02-11 duplicate cascade incident
  - **DRY RUN by default:** All order imports now DRY RUN unless `confirm=true` is explicitly passed
  - **Enhanced duplicate detection:** Check order_mappings DB + Shopify tag search + fuzzy matching (total + date + buyer)
  - **SAFETY_MODE env var:** Default "safe" mode enforces rate limiting (max 1 order per 10 seconds, 5 per hour)
  - **UI warning banner:** Prominent critical banner in EbayOrders.tsx about Lightspeed POS downstream impact
  - **API endpoint guards:** Both /api/sync/trigger and /api/ebay/orders/import respect safety guards
  - **Enhanced logging:** All safety actions logged with context and warnings array in SyncResult
  - **Updated capabilities:** Order sync capability updated to reflect new safety features

### 2026-02-21
- OpenAI `withRetry()` helper with exponential backoff (commit c7c3076)

### 2026-02-18
- Photo editor full rewrite (raw HTML overlay, GCS cutouts, native sliders)
- GCS photo storage (`pictureline-product-photos` bucket, signed URLs)
- Pipeline overhaul: 4000×4000 canvas, 2000px resize, timeouts, SSE progress, cancel button
- Product detail page redesign (commit 3ab5618)
- AI description prompt rewritten (no hype)

### 2026-02-17
- Self-hosted image processing: BiRefNet ONNX, factory pattern (commit 630972f)
- Training data collected (254 originals, 94 matched pairs, 1346 lines fine-tuning code)
- TIM condition integration (tags, AI injection, manual pipeline trigger)
- Category mapping UI (commit fe37a46)
- Review queue nav fix, markdown→HTML, inline approval, rename to ProductPipeline
