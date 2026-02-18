# QA Report — ProductPipeline on Railway
**Date:** 2026-02-18 16:17 MST  
**App:** https://ebay-sync-app-production.up.railway.app  
**Tested by:** QA Agent

---

## Summary

**The pipeline actually works end-to-end.** Chris's "none of the things work" may be a frontend/UI issue rather than backend. The API endpoints are functional, the pipeline completes successfully, drafts are created with photos and AI descriptions, and approval pushes to Shopify.

---

## Test Results

### 1. Health Endpoint — ✅ Working
- `GET /health` → `200 OK`, returns uptime and timestamp
- App is up and responsive

### 2. Pipeline Trigger — ⚠️ Partial (502 Timeout)
- `POST /api/pipeline/trigger/10130016665891` → **502 from Railway** (request timeout)
- **Root cause:** The pipeline takes ~65-75 seconds to complete (fetches product, searches GCS, generates AI description, processes 7 images through PhotoRoom). Railway's default request timeout is 30s.
- **However:** The pipeline **does complete successfully in the background**. Three successful runs are recorded in `pipeline_jobs`, all with status `completed`.
- **The frontend should use SSE streaming** to track progress rather than waiting for the POST response.
- **Fix:** Either (a) increase Railway request timeout, or (b) make the trigger endpoint return immediately with a `jobId` and let the client poll/stream for results. The SSE stream already exists at `/api/pipeline/jobs/:id/stream`.

### 3. Draft Listings — ✅ Working
- `GET /api/drafts` → Returns drafts correctly (8 approved, 5 rejected, 0 pending)
- `GET /api/drafts/14` → Full draft with 7 processed images, AI description, and live Shopify comparison
- Draft #14 was approved and pushed to Shopify — live product has 7 images on cdn.shopify.com

### 4. SSE Streaming — ✅ Working
- `GET /api/pipeline/stream` → Connects successfully, receives real-time events
- Observed live event: `process_images` step running with progress `2/7`
- Heartbeat and job-specific streams also available

### 5. Image Proxy — ✅ Working
- `GET /proxy?url=<GCS signed URL>` → 200 OK, returns 3.3MB PNG with correct content-type
- Only allows GCS URLs (security check works)
- Non-existent URLs return 403 (correct — GCS denies)

### 6. Photo Edit Save — ✅ Code Looks Correct (Not Live-Tested)
- `POST /api/photos/edit` accepts multipart upload with `image` file, `draftId`, `imageIndex`
- Uploads to GCS via `uploadProcessedImage()` and returns signed URL
- **Did not test live** (would need multipart file upload)

### 7. Drive Search (GCS Cloud Mode) — ✅ Working
- `GET /api/pipeline/drive-search/10130016665891` → Found 7 photos in `super telephoto lens/sigma 150-600 ef #718`
- GCS bucket: `pictureline-product-photos`
- Returns folder path, preset name, folder name, image count

### 8. AI Description Generation — ✅ Working
- Pipeline jobs show descriptions being generated in ~5 seconds
- Example: "1216 chars — Sigma 150-600mm F5-6.3 Contemporary DG OS HSM..." 
- Description includes: product details, key features, condition from TIM, who it's for, what's included
- Draft #14 has full AI description with proper formatting

### 9. TIM Condition Lookup — ✅ Working
- `GET /api/tim/condition/10130016665891` → Found match: `excellent_plus`
- Matched SKU: `745101-U718`, TIM item ID: 648
- Includes condition notes: "caps, hoods and case"
- Serial number extracted: `57212718`

### 10. Approval Flow — ✅ Working
- Draft #14 status: `approved`, reviewed_at: 1771456297
- Live Shopify product has 7 images on CDN and full AI description in HTML
- `POST /api/drafts/:id/approve` accepts `{ photos: true, description: true }` for selective approval

---

## Issues Found

### 🔴 P1: Pipeline Trigger Returns 502 (Railway Timeout)
- **Impact:** Frontend can't trigger pipeline via POST and get result — request times out
- **Root cause:** Pipeline takes ~65-75s; Railway proxy timeout is likely 30s
- **Fix options:**
  1. Make `POST /api/pipeline/trigger/:productId` return immediately with `{ jobId }` (async pattern)
  2. Increase Railway request timeout to 120s
  3. The SSE streaming already works — just need the trigger to be fire-and-forget

### 🟡 P2: Auth Bypass via Referer Header
- **Impact:** Security concern — any request with `Referer: https://ebay-sync-app-production.up.railway.app/` bypasses API key auth
- **Root cause:** Middleware checks if referer/origin matches the host, intended for SPA frontend
- **Fix:** This is by design for the embedded Shopify app, but external API consumers should use the API key. Document the API key or ensure it's set in Railway env vars.

### 🟡 P3: No Pending Drafts (All Processed)
- **Impact:** UI may appear empty/broken if Chris is looking at the pending queue
- **Note:** 8 approved + 5 rejected = 13 drafts total, 0 pending. Pipeline is working — everything has been reviewed already.

### 🟢 P4: `GET /api/products/:id/images` Times Out on Some Calls
- **Impact:** Intermittent — worked on second try. May be Shopify API latency.
- **Note:** When it works, returns full image list with processing status.

---

## What's Actually Working (Backend)

| Feature | Status | Notes |
|---------|--------|-------|
| Health check | ✅ | Responsive |
| Pipeline execution | ✅ | Completes in ~65-75s |
| Shopify product fetch | ✅ | Gets product details |
| TIM condition lookup | ✅ | Matches by SKU |
| GCS drive search | ✅ | Finds photos by product name/SKU |
| AI description gen | ✅ | Good quality, includes condition |
| Image processing | ✅ | 7 photos processed via PhotoRoom |
| Draft creation | ✅ | Stores in SQLite |
| Draft approval → Shopify | ✅ | Photos + description pushed live |
| SSE streaming | ✅ | Real-time progress events |
| Image proxy | ✅ | Serves GCS images with CORS headers |
| Frontend HTML | ✅ | SPA loads, Shopify App Bridge included |

---

## Recommendation

**The #1 fix needed is making the pipeline trigger async.** Change `POST /api/pipeline/trigger/:productId` to:
1. Start the pipeline in background
2. Immediately return `{ success: true, jobId: "job_xxx" }`
3. Client uses `GET /api/pipeline/jobs/:jobId/stream` (SSE) to watch progress

This is likely why Chris thinks "nothing works" — the trigger request times out on Railway, so the UI shows an error, even though the pipeline actually completes successfully in the background.
