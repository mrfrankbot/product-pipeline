/**
 * Watcher API routes — control and monitor the StyleShoots folder watcher.
 *
 * POST /api/watcher/start     — Start the watcher
 * POST /api/watcher/stop      — Stop the watcher
 * GET  /api/watcher/status    — Watcher status + stats
 * GET  /api/watcher/unmatched — Folders that couldn't be matched to Shopify products
 * GET  /api/watcher/recent    — Recent watcher log entries
 * POST /api/watcher/link      — Manually link an unmatched folder to a Shopify product
 */
declare const router: import("express-serve-static-core").Router;
export default router;
