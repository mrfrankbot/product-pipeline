# StyleShoots Folder Watcher — Design Document

> **Status**: Design only — not yet implemented.
> **Author**: Frank (subagent), February 16, 2026

## Problem

When a used camera product is photographed on the StyleShoots machine, images are saved to a network drive at `smb://192.168.15.243/StyleShootsDrive`, mounted locally at `/Volumes/StyleShootsDrive`. Product photos land in the `UsedCameraGear/` subfolder using a naming convention of `"product name #lastThreeSerialDigits"` (e.g., `sigma 24-70 #624`).

Currently, these photos must be manually associated with Shopify products and fed into the auto-listing pipeline. This module automates that handoff.

## Goals

1. **Watch** `/Volumes/StyleShootsDrive/UsedCameraGear/` for new product folders
2. **Parse** folder names to extract product name + serial suffix
3. **Match** to existing Shopify products by title/serial
4. **Trigger** the existing auto-listing pipeline with local photo file paths
5. **Track** processed folders to avoid duplicate runs

## Architecture Overview

```
/Volumes/StyleShootsDrive/UsedCameraGear/
    ├── sigma 24-70 #624/
    │   ├── front.jpg
    │   ├── back.jpg
    │   └── detail.jpg
    ├── sony a7iv #331/
    │   ├── image_001.jpg
    │   └── image_002.jpg
    └── canon rf 50mm #088/
        └── ...

         │
         │  fs.watch / chokidar
         ▼

┌────────────────────────────────────────┐
│  StyleShoots Watcher Module            │
│                                        │
│  1. Detect new folder                  │
│  2. Wait for images to stabilize       │
│  3. Parse folder name → product + sn   │
│  4. Search Shopify for matching product│
│  5. Call autoListProduct() w/ local    │
│     image file paths                   │
│  6. Record in SQLite                   │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  Existing Auto-Listing Pipeline        │
│  (auto-listing-pipeline.ts)            │
│                                        │
│  Step 1: Fetch product (Shopify)       │
│  Step 2: AI description (OpenAI)       │
│  Step 3: Image processing (PhotoRoom)  │
│          ← NOW accepts local files     │
│  Step 4: Create eBay listing           │
└────────────────────────────────────────┘
```

## Module Structure

### New Files

```
src/
├── watcher/
│   ├── index.ts              # Watcher entry point — start/stop/status
│   ├── folder-parser.ts      # Parse folder names → { productName, serialSuffix }
│   ├── shopify-matcher.ts    # Search Shopify products by name/serial
│   ├── stabilizer.ts         # Wait for folder contents to stop changing
│   └── watcher-db.ts         # SQLite table for tracking processed folders
```

### New SQLite Table

```sql
CREATE TABLE IF NOT EXISTS styleshoot_watch_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_name TEXT NOT NULL UNIQUE,       -- "sigma 24-70 #624"
  folder_path TEXT NOT NULL,              -- Full path
  parsed_product_name TEXT,               -- "sigma 24-70"
  parsed_serial_suffix TEXT,              -- "624"
  shopify_product_id TEXT,                -- Matched Shopify product ID (null if unmatched)
  match_confidence TEXT,                  -- "exact", "fuzzy", "manual", "unmatched"
  image_count INTEGER DEFAULT 0,          -- Number of images found
  pipeline_job_id TEXT,                   -- Pipeline job ID (from autoListProduct)
  status TEXT DEFAULT 'detected',         -- detected → matching → processing → done / error / unmatched
  error TEXT,                             -- Error message if failed
  detected_at INTEGER NOT NULL,           -- When folder was first seen
  processed_at INTEGER,                   -- When pipeline completed
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_watch_log_status ON styleshoot_watch_log(status);
CREATE INDEX idx_watch_log_folder ON styleshoot_watch_log(folder_name);
```

## Component Design

### 1. Folder Watcher (`index.ts`)

**Approach**: Use `chokidar` (battle-tested file watcher with macOS FSEvents support) to recursively watch the target directory.

```
Watcher lifecycle:
1. On startup: scan existing folders, skip already-processed (in DB)
2. Watch for `addDir` events in UsedCameraGear/
3. On new folder: wait for stabilization → parse → match → pipeline
4. On SMB disconnect: log warning, retry connection on interval
5. Graceful shutdown: stop watcher, flush pending
```

**Configuration** (via `settings` table or env vars):
| Setting | Default | Description |
|---------|---------|-------------|
| `styleshoot_watch_enabled` | `false` | Master on/off switch |
| `styleshoot_watch_path` | `/Volumes/StyleShootsDrive/UsedCameraGear/` | Watch directory |
| `styleshoot_stabilize_ms` | `30000` | Wait time after last file change before processing |
| `styleshoot_auto_process` | `true` | Auto-run pipeline on match (vs. queue for manual review) |
| `styleshoot_min_images` | `1` | Minimum images required to trigger processing |

### 2. Folder Name Parser (`folder-parser.ts`)

**Input**: Folder name string (e.g., `"sigma 24-70 #624"`)
**Output**: `{ productName: string, serialSuffix: string | null }`

**Parsing rules**:
1. Look for `#` followed by digits at the end → serial suffix
2. Everything before `#` (trimmed) → product name
3. Handle edge cases:
   - No `#` → entire name is product name, serial is `null`
   - Multiple `#` → last one is serial
   - Spaces/hyphens in product name → preserve as-is
   - Leading/trailing whitespace → trim

**Examples**:
| Folder Name | Product Name | Serial Suffix |
|-------------|-------------|---------------|
| `sigma 24-70 #624` | `sigma 24-70` | `624` |
| `sony a7iv #331` | `sony a7iv` | `331` |
| `canon rf 50mm f1.8 #088` | `canon rf 50mm f1.8` | `088` |
| `hasselblad x2d` | `hasselblad x2d` | `null` |
| `nikon z 180-600 #12` | `nikon z 180-600` | `12` |

### 3. Shopify Product Matcher (`shopify-matcher.ts`)

**Strategy**: Multi-pass matching with decreasing confidence.

```
Pass 1 — Exact title match (case-insensitive)
  Search Shopify products where title contains the parsed product name
  AND (if serial present) SKU or title ends with serial digits
  → confidence: "exact"

Pass 2 — Fuzzy title match
  Tokenize product name, search for products matching most tokens
  Score by token overlap ratio
  → confidence: "fuzzy" (if score > 0.7)

Pass 3 — Serial-only match
  If serial suffix present, search products by SKU suffix
  → confidence: "fuzzy"

Pass 4 — No match
  → confidence: "unmatched", queue for manual review
```

**Implementation detail**: Use the existing `fetchAllShopifyProductsOverview()` function to get all products, then do matching in-memory. With 830+ products, this is fast enough. Cache the product list and refresh every 5 minutes.

**Match resolution**:
- If exactly 1 match → proceed automatically
- If multiple matches → log warning, pick highest confidence, flag for review
- If 0 matches → mark as `unmatched`, surface in UI for manual linking

### 4. Content Stabilizer (`stabilizer.ts`)

**Problem**: Files may still be copying from the StyleShoots machine when we detect the folder. We need to wait until all images are fully written.

**Approach**:
1. On folder detection, start a debounce timer (`styleshoot_stabilize_ms`, default 30s)
2. Reset timer on any file change within the folder (new file, size change)
3. When timer fires without interruption → folder is "stable"
4. Additional check: verify all image files are non-zero size and can be opened

**Image file detection**:
- Glob for `*.jpg`, `*.jpeg`, `*.png`, `*.tiff`, `*.tif` (case-insensitive)
- Ignore hidden files (`.DS_Store`, `._*`)
- Ignore non-image files

### 5. Watcher DB (`watcher-db.ts`)

Simple CRUD layer for the `styleshoot_watch_log` table:
- `isProcessed(folderName)` → boolean
- `recordDetection(folderName, folderPath, parsed)` → id
- `updateMatch(id, shopifyProductId, confidence)` → void
- `updatePipelineResult(id, jobId, status)` → void
- `getUnmatched()` → array (for UI review)
- `getPending()` → array (detected but not yet processed)
- `getRecent(limit)` → array (for dashboard)

## Pipeline Integration

### What Needs to Change

The current `processProductImages()` function in `auto-listing-pipeline.ts` **only** accepts Shopify image URLs. It needs to also accept local file paths.

#### Option A: Modify Pipeline to Accept Local Files (Recommended)

Add an optional parameter to `autoListProduct()`:

```typescript
export async function autoListProduct(
  shopifyProductId: string,
  options?: {
    localImagePaths?: string[];  // NEW: override Shopify images with local files
  }
): Promise<{ success: boolean; jobId?: string; ... }>
```

**Changes to `processProductImages()`**:
1. If `localImagePaths` provided → use those instead of fetching from Shopify
2. PhotoRoom's `renderWithTemplate()` currently takes a URL — need to:
   - Either upload local file to a temp URL first
   - Or use PhotoRoom's file-upload variant (it already supports `imageFile` in FormData)
3. The `PhotoRoomService.renderWithTemplate()` method needs a `renderWithLocalFile(filePath)` variant

**PhotoRoom change** (`src/services/photoroom.ts`):
```
Current:  renderWithTemplate(imageUrl: string, templateId?: string)
Add:      renderWithLocalFile(filePath: string, templateId?: string)
```

The `renderWithLocalFile` method would:
1. Read the file from disk (`fs.readFileSync(filePath)`)
2. Create a `FormData` with `imageFile` (blob) instead of `imageUrl`
3. Submit to the same PhotoRoom render endpoint

#### Option B: Upload to Shopify First, Then Pipeline

1. Watcher uploads local images to the matched Shopify product via REST API
2. Then calls `autoListProduct(shopifyProductId)` with no changes
3. Pros: No pipeline changes needed
4. Cons: Extra upload step, images go through Shopify CDN unnecessarily, slower

**Recommendation**: Option A — minimal changes, more efficient, keeps local files local until they go to PhotoRoom/eBay.

### Pipeline Flow with StyleShoots

```
Watcher detects folder "sigma 24-70 #624"
  → Wait for stabilization (30s no changes)
  → Parse: productName="sigma 24-70", serial="624"
  → Search Shopify: find product ID 8234567890
  → Collect image paths: ["/Volumes/.../front.jpg", "/Volumes/.../back.jpg"]
  → Call autoListProduct("8234567890", { localImagePaths: [...] })
    → Step 1: Fetch product from Shopify (get title, vendor, price)
    → Step 2: Generate AI description (OpenAI)
    → Step 3: Process images via PhotoRoom (using local files!)
    → Step 4: Save to eBay (description + processed images + category)
  → Record result in styleshoot_watch_log
```

## Server Integration

### Startup

Add watcher initialization to `src/server/index.ts`:

```
start() {
  ...existing setup...

  // Start StyleShoots watcher if enabled
  if (settings.styleshoot_watch_enabled === 'true') {
    startStyleShootWatcher();
  }
}
```

### API Endpoints

Add to a new route file `src/server/routes/watcher.ts`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/watcher/status` | Watcher running state, last scan time, mount status |
| `GET` | `/api/watcher/log` | Recent watcher log entries (processed, unmatched, errors) |
| `GET` | `/api/watcher/unmatched` | Folders that couldn't be matched to Shopify products |
| `POST` | `/api/watcher/link` | Manually link an unmatched folder to a Shopify product ID |
| `POST` | `/api/watcher/reprocess/:id` | Re-run pipeline for a previously processed folder |
| `POST` | `/api/watcher/start` | Start/restart the watcher |
| `POST` | `/api/watcher/stop` | Stop the watcher |

### UI Integration

Add a "StyleShoots" tab/page to the embedded UI:
- Show watcher status (running/stopped, mount connected/disconnected)
- Table of recently detected folders with status badges
- "Unmatched" queue with manual product linking
- Settings for watcher configuration

## Edge Cases

### 1. Unmatched Products
- **Scenario**: Folder name doesn't match any Shopify product
- **Handling**: Mark as `unmatched`, surface in UI, allow manual linking via API
- **Notification**: Optionally send alert (future: Slack/email integration)

### 2. SMB Disconnects
- **Scenario**: Network drive unmounted or unreachable
- **Detection**: `chokidar` emits `error` event; also periodic health check (`fs.access` on mount point)
- **Handling**:
  - Log warning, set watcher status to `disconnected`
  - Retry mount check every 60 seconds
  - When reconnected: rescan for any folders missed during disconnect
  - **Do NOT** crash the server — watcher is a non-critical feature

### 3. Duplicate Folders
- **Scenario**: Same folder name processed twice (e.g., server restart)
- **Handling**: `folder_name UNIQUE` constraint in DB; check before processing
- **Re-processing**: Must be explicitly requested via `POST /api/watcher/reprocess/:id`

### 4. Incomplete Uploads
- **Scenario**: StyleShoots is still copying files when folder is detected
- **Handling**: Stabilizer waits 30s after last file change; verifies file sizes > 0
- **Safety**: If stabilizer times out (5 min max), process what's available and flag for review

### 5. Empty Folders
- **Scenario**: Folder created but no images inside
- **Handling**: After stabilization, check image count. If 0 images, mark as `error` with message "No images found"
- **Skip**: Don't trigger pipeline for empty folders

### 6. Large Images / Slow Network
- **Scenario**: StyleShoots produces large TIFF files; SMB transfer is slow
- **Handling**: Stabilizer handles this naturally (waits for writes to finish)
- **Optimization**: Process JPEG/PNG first; skip TIFF if JPEG version exists

### 7. Folder Name Collisions
- **Scenario**: Two products with similar names (e.g., "sigma 24-70 f2.8" vs "sigma 24-70 f4")
- **Handling**: Serial suffix differentiates; if no serial, fuzzy match may return multiple — flag for manual review
- **Prevention**: Enforce serial suffix convention in team workflow

### 8. Server Restart
- **Scenario**: Server restarts while watcher has pending items
- **Handling**: On startup, scan all existing folders, check DB for processed state, resume any `detected` or `matching` status items

### 9. Folder Renames / Deletes
- **Scenario**: Photographer renames or deletes a folder after creation
- **Handling**: If already processed → no action. If pending → cancel and update DB status to `cancelled`

### 10. Mount Point Permissions
- **Scenario**: Server user doesn't have read access to SMB mount
- **Handling**: Check permissions on startup, log clear error message, don't start watcher

## Dependencies

| Package | Purpose | Already in project? |
|---------|---------|-------------------|
| `chokidar` | File system watcher | ❌ Add |
| `better-sqlite3` | SQLite DB | ✅ Yes |
| `fs/path` (node) | File operations | ✅ Built-in |

Only **one new dependency**: `chokidar`.

## Testing Plan

1. **Unit tests**: folder-parser with various naming patterns
2. **Unit tests**: shopify-matcher with mock product lists
3. **Integration test**: create a test folder on local disk, verify watcher detects and processes
4. **Manual test**: copy a real StyleShoots folder to the watch directory, verify end-to-end

## Open Questions

1. **Should the watcher run on Railway or only locally?** — Railway can't access the SMB mount. This module only works when the server runs on-premise (Frank's Mac or store network). Need a strategy for Railway deployment:
   - Option A: Watcher runs as a separate local process that calls the Railway API
   - Option B: Watcher runs on Railway but watches a synced cloud folder (Dropbox/Google Drive mirror)
   - Option C: Watcher is a standalone CLI tool, not part of the server

2. **Should we support re-photographing?** — If a product is re-shot with better photos, should the watcher update the existing listing? Would need `folder_name` to allow re-processing with a flag.

3. **Notification preferences** — When an unmatched folder is found, how should the team be notified? (Shopify admin notification, Slack, email, or just the UI?)

---

*Design doc created February 16, 2026. Implementation pending.*
