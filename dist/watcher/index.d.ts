/**
 * StyleShoots Folder Watcher — Phase 1
 *
 * Watches /Volumes/StyleShootsDrive/UsedCameraGear/ for new product folders.
 * When a folder stabilizes (30s no file changes), it:
 *   1. Parses the folder name for product name + serial suffix
 *   2. Searches Shopify for a matching product
 *   3. Uploads the JPEG images directly to the matched Shopify product
 *   4. Records the result in the styleshoot_watch_log table
 *
 * Folder structure:
 *   UsedCameraGear/{preset}/{productName}/photos.jpg
 *
 * Preset folders (e.g. "Trade-Ins - Small Lenses") are tracked as categories.
 */
import { getUnmatched, getRecent } from './watcher-db.js';
export interface WatcherStatus {
    running: boolean;
    watchPath: string;
    mountConnected: boolean;
    lastScanTime: number | null;
    stats: {
        total: number;
        done: number;
        unmatched: number;
        errors: number;
        pending: number;
    };
}
/**
 * Start the folder watcher.
 */
export declare function startWatcher(options?: {
    watchPath?: string;
    stabilizeMs?: number;
}): Promise<void>;
/**
 * Stop the folder watcher.
 */
export declare function stopWatcher(): Promise<void>;
/**
 * Get the current watcher status.
 */
export declare function getStatus(): Promise<WatcherStatus>;
/**
 * Re-export for route access.
 */
export { getUnmatched, getRecent };
