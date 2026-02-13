# Codex Task: Product Management Hub + Pipeline Rewrite + Minor Bug Fixes

## Overview
This eBay Sync App connects a Shopify store (usedcameragear.myshopify.com) to eBay. It needs a major upgrade to the product management experience and pipeline page, plus 4 minor bug fixes.

**Tech stack:** React + TypeScript + @shopify/polaris + @tanstack/react-query + Express + better-sqlite3 + Drizzle ORM. Vite for bundling.

## Task 1: Unified Product Management Page (NEW — replace current /listings)

The current `/listings` (ShopifyProducts.tsx) is a basic product list. Replace it with a comprehensive **Product Management Hub** that shows ALL Shopify products with their full pipeline status.

### New `/listings` page should show:

**Summary cards at top:**
- Total products (from Shopify)
- Products with AI descriptions generated
- Products with images processed
- Products listed on eBay (active)
- Products in draft on eBay

**Product table with columns:**
| Column | Source | Notes |
|--------|--------|-------|
| Thumbnail | Shopify product image | Small 40x40 |
| Product Name | Shopify title | Link to detail page |
| SKU | Shopify variant SKU | |
| Price | Shopify variant price | Format with $ and commas |
| Shopify Status | Shopify product status | Badge: active=green, draft=blue, archived=yellow |
| AI Description | Check if auto-list job exists | Badge: ✅ Done / ❌ Not yet |
| Images Processed | Check if PhotoRoom processed | Badge: ✅ Done / ❌ Not yet |
| eBay Status | From product_mappings table | Badge: Listed (green) / Draft (blue) / Not Listed (gray) |
| Actions | Buttons | "Run Pipeline" / "View on eBay" |

**Filters:**
- Status filter: All / Ready to List / Needs Description / Needs Images / Listed / Not Listed
- Search by name/SKU
- Sort by any column

### Backend API needed: `GET /api/products/overview`

This endpoint should:
1. Fetch all products from Shopify (paginated)
2. Cross-reference with `product_mappings` table for eBay status
3. Cross-reference with pipeline job history for description/image status
4. Return unified product list with all statuses

**Response shape:**
```json
{
  "products": [
    {
      "shopifyProductId": "123",
      "title": "Sony FE 50mm...",
      "sku": "PL-1042",
      "price": "179.99",
      "shopifyStatus": "active",
      "imageUrl": "https://cdn.shopify.com/...",
      "imageCount": 3,
      "hasAiDescription": true,
      "hasProcessedImages": false,
      "ebayStatus": "draft",
      "ebayListingId": "draft-123",
      "pipelineJobId": "job_123"
    }
  ],
  "summary": {
    "total": 1,
    "withDescriptions": 1,
    "withProcessedImages": 0,
    "listedOnEbay": 0,
    "draftOnEbay": 1
  }
}
```

To track whether AI descriptions and images have been processed, add a new table:

```sql
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
```

Update the auto-listing pipeline (`src/sync/auto-listing-pipeline.ts`) to write to this table when descriptions/images are generated.

### Detail page (`/listings/:id`) improvements:
- Show the AI-generated description if it exists (from `product_pipeline_status`)
- Show pipeline progress steps (like the pipeline page visualization)
- Show "Run Pipeline" button that triggers the full pipeline
- Show all images with before/after PhotoRoom processing

## Task 2: Pipeline Page Rewrite (/pipeline)

The pipeline page currently shows fake sample data. Rewrite it to show REAL data.

### Pipeline page should:
1. **Keep the cool 4-stage flow visualization** (Shopify Import → AI Description → Image Processing → eBay Listing) — it looks great
2. **Show real pipeline jobs** from `GET /api/pipeline/jobs` (the backend already tracks jobs in-memory via `src/sync/pipeline-status.ts`)
3. **Make the job table show real product names** by looking up Shopify product titles
4. **Add a "Run Pipeline" input** at the top (already exists, keep it)
5. **Show real stats** — count actual completed/processing/queued/failed jobs from the in-memory store
6. **Remove ALL sample/fake data** — use empty state if no jobs exist

### Pipeline jobs table columns:
| Column | Data |
|--------|------|
| Product | Shopify title (fetched from product info) |
| Status | Badge: Queued/Processing/Completed/Failed |
| Current Step | Which of the 4 pipeline steps is active |
| Started | Timestamp |
| Duration | Time elapsed or total time |

### Also persist pipeline jobs to SQLite
The current in-memory store loses jobs on restart. Add persistence:

```sql
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
```

Update `src/sync/pipeline-status.ts` to write to this table as well as the in-memory store. Update `src/server/routes/pipeline.ts` to read from the DB instead of just memory.

## Task 3: Fix 4 Minor Bugs

### Bug 9: "Quick actions" column header cut off on eBay Listings page
- File: `src/web/pages/Listings.tsx`
- The rightmost column "Quick actions" is clipped. Make it wider or use a shorter label like "Actions"

### Bug 10: Catalog snapshot shows 0/0/0 — doesn't count drafts
- File: `src/web/pages/Listings.tsx` or Dashboard
- Add a "Draft" counter alongside Active/Missing/Errors, or include drafts in the Active count

### Bug 11: Analytics "Latest sync history" section empty with no empty state message
- File: `src/web/pages/Analytics.tsx`
- When no sync history exists, show "No sync activity yet" instead of an empty table

### Bug 12: Help Admin question list doesn't show question text
- File: `src/web/pages/HelpAdmin.tsx`
- The question list items should display the question text, not just metadata

## Technical Requirements

1. **Use existing patterns:** Look at how other pages are built. Use `@shopify/polaris` components (Page, Card, IndexTable, Badge, etc.), `@tanstack/react-query` for data fetching, and `apiClient` from `src/web/hooks/useApi.ts` for API calls.

2. **Database migrations:** Add new tables in `src/db/client.ts` in the `initExtraTables()` function using `CREATE TABLE IF NOT EXISTS`.

3. **API routes:** Add new routes in `src/server/routes/api.ts`. Use the existing pattern with `getRawDb()` for raw queries and Drizzle for typed queries.

4. **TypeScript:** Must compile cleanly with `npx tsc --noEmit`.

5. **Import the Shopify access token** from `auth_tokens` table, platform='shopify'. Use `fetchDetailedShopifyProduct` from `src/shopify/products.ts` for detailed product info.

6. **Don't break existing routes or pages.** The current `/ebay/listings` page should remain as-is.

7. **Router update:** Update `src/web/App.tsx` if adding new routes. Update `src/web/components/AppNavigation.tsx` if changing nav structure.

## File Map
- `src/web/App.tsx` — Routes
- `src/web/components/AppNavigation.tsx` — Sidebar navigation
- `src/web/pages/ShopifyProducts.tsx` — Current products page (REWRITE)
- `src/web/pages/Pipeline.tsx` — Pipeline page (REWRITE)
- `src/web/pages/Listings.tsx` — eBay listings page (minor fixes only)
- `src/web/pages/Analytics.tsx` — Analytics/logs page (minor fix)
- `src/web/pages/HelpAdmin.tsx` — Help admin (minor fix)
- `src/web/pages/Dashboard.tsx` — Dashboard
- `src/web/hooks/useApi.ts` — API client
- `src/server/routes/api.ts` — Main API routes
- `src/server/routes/pipeline.ts` — Pipeline API routes
- `src/sync/pipeline-status.ts` — Pipeline job tracking
- `src/sync/auto-listing-pipeline.ts` — Auto-listing pipeline
- `src/db/client.ts` — Database initialization
- `src/db/schema.ts` — Drizzle schema
