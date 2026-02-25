/**
 * watcher-db.ts — SQLite operations for the styleshoot_watch_log table.
 *
 * Tracks processed folders to avoid duplicates and provides queries
 * for unmatched/pending/recent items.
 */
import { getRawDb } from '../db/client.js';
import { info } from '../utils/logger.js';
/**
 * Initialize the styleshoot_watch_log table. Called once at startup.
 */
export async function initWatcherTable() {
    const db = await getRawDb();
    db.exec(`
    CREATE TABLE IF NOT EXISTS styleshoot_watch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_name TEXT NOT NULL,
      folder_path TEXT NOT NULL UNIQUE,
      preset_name TEXT,
      parsed_product_name TEXT,
      parsed_serial_suffix TEXT,
      shopify_product_id TEXT,
      shopify_product_title TEXT,
      match_confidence TEXT,
      image_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'detected',
      error TEXT,
      detected_at INTEGER NOT NULL,
      processed_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `);
    // Create indexes if they don't exist
    db.exec(`CREATE INDEX IF NOT EXISTS idx_watch_log_status ON styleshoot_watch_log(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_watch_log_folder ON styleshoot_watch_log(folder_path);`);
    info('[WatcherDB] styleshoot_watch_log table ready');
    // Crash recovery: reset any "uploading" entries back to "matched" so they get retried
    await recoverStuckUploads();
}
/**
 * Crash recovery: reset any folders stuck in 'uploading' status back to 'matched'
 * so they get retried on the next scan. This handles the case where the process
 * crashed mid-upload.
 */
export async function recoverStuckUploads() {
    const db = await getRawDb();
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`
    UPDATE styleshoot_watch_log
    SET status = 'matched', error = NULL, updated_at = ?
    WHERE status = 'uploading'
  `).run(now);
    if (result.changes > 0) {
        info(`[WatcherDB] Crash recovery: reset ${result.changes} stuck 'uploading' entries back to 'matched'`);
    }
}
/**
 * Check if a folder has already been processed.
 */
export async function isProcessed(folderPath) {
    const db = await getRawDb();
    const row = db
        .prepare(`SELECT status FROM styleshoot_watch_log WHERE folder_path = ?`)
        .get(folderPath);
    // Considered "processed" if status is done
    return row?.status === 'done';
}
/**
 * Check if a folder already has a record (any status).
 */
export async function hasRecord(folderPath) {
    const db = await getRawDb();
    const row = db
        .prepare(`SELECT id FROM styleshoot_watch_log WHERE folder_path = ?`)
        .get(folderPath);
    return !!row;
}
/**
 * Record that a new folder was detected.
 */
export async function recordDetection(params) {
    const db = await getRawDb();
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`
    INSERT INTO styleshoot_watch_log
      (folder_name, folder_path, preset_name, parsed_product_name, parsed_serial_suffix, image_count, status, detected_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'detected', ?, ?, ?)
  `).run(params.folderName, params.folderPath, params.presetName ?? null, params.productName ?? null, params.serialSuffix ?? null, params.imageCount ?? 0, now, now, now);
    return Number(result.lastInsertRowid);
}
/**
 * Update the Shopify match for a watch log entry.
 */
export async function updateMatch(id, shopifyProductId, shopifyProductTitle, confidence) {
    const db = await getRawDb();
    const now = Math.floor(Date.now() / 1000);
    const status = shopifyProductId ? 'matched' : 'unmatched';
    db.prepare(`
    UPDATE styleshoot_watch_log
    SET shopify_product_id = ?, shopify_product_title = ?, match_confidence = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(shopifyProductId, shopifyProductTitle, confidence, status, now, id);
}
/**
 * Update status to 'uploading' when we start uploading images.
 */
export async function updateUploading(id) {
    const db = await getRawDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    UPDATE styleshoot_watch_log SET status = 'uploading', updated_at = ? WHERE id = ?
  `).run(now, id);
}
/**
 * Update status to 'done' after successful upload.
 */
export async function updateDone(id, imageCount) {
    const db = await getRawDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    UPDATE styleshoot_watch_log
    SET status = 'done', image_count = ?, processed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(imageCount, now, now, id);
}
/**
 * Update status to 'error' with error message.
 */
export async function updateError(id, error) {
    const db = await getRawDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    UPDATE styleshoot_watch_log SET status = 'error', error = ?, updated_at = ? WHERE id = ?
  `).run(error, now, id);
}
/**
 * Get all unmatched folders (for manual review).
 */
export async function getUnmatched() {
    const db = await getRawDb();
    return db.prepare(`
    SELECT * FROM styleshoot_watch_log WHERE status = 'unmatched' ORDER BY detected_at DESC
  `).all();
}
/**
 * Get all pending folders (detected but not yet processed).
 */
export async function getPending() {
    const db = await getRawDb();
    return db.prepare(`
    SELECT * FROM styleshoot_watch_log WHERE status IN ('detected', 'matched') ORDER BY detected_at ASC
  `).all();
}
/**
 * Get recent watch log entries.
 */
export async function getRecent(limit = 50) {
    const db = await getRawDb();
    return db.prepare(`
    SELECT * FROM styleshoot_watch_log ORDER BY detected_at DESC LIMIT ?
  `).all(limit);
}
/**
 * Get watcher stats summary.
 */
export async function getWatcherStats() {
    const db = await getRawDb();
    const total = db.prepare(`SELECT COUNT(*) as c FROM styleshoot_watch_log`).get()?.c ?? 0;
    const done = db.prepare(`SELECT COUNT(*) as c FROM styleshoot_watch_log WHERE status = 'done'`).get()?.c ?? 0;
    const unmatched = db.prepare(`SELECT COUNT(*) as c FROM styleshoot_watch_log WHERE status = 'unmatched'`).get()?.c ?? 0;
    const errors = db.prepare(`SELECT COUNT(*) as c FROM styleshoot_watch_log WHERE status = 'error'`).get()?.c ?? 0;
    const pending = db.prepare(`SELECT COUNT(*) as c FROM styleshoot_watch_log WHERE status IN ('detected', 'matched', 'uploading')`).get()?.c ?? 0;
    return { total, done, unmatched, errors, pending };
}
/**
 * Manually link an unmatched folder to a Shopify product (for review UI).
 */
export async function manualLink(id, shopifyProductId, shopifyProductTitle) {
    const db = await getRawDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    UPDATE styleshoot_watch_log
    SET shopify_product_id = ?, shopify_product_title = ?, match_confidence = 'manual', status = 'matched', updated_at = ?
    WHERE id = ?
  `).run(shopifyProductId, shopifyProductTitle, now, id);
}
