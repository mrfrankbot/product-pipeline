/**
 * watcher-db.ts — SQLite operations for the styleshoot_watch_log table.
 *
 * Tracks processed folders to avoid duplicates and provides queries
 * for unmatched/pending/recent items.
 */
export interface WatchLogEntry {
    id: number;
    folder_name: string;
    folder_path: string;
    preset_name: string | null;
    parsed_product_name: string | null;
    parsed_serial_suffix: string | null;
    shopify_product_id: string | null;
    shopify_product_title: string | null;
    match_confidence: string | null;
    image_count: number;
    status: string;
    error: string | null;
    detected_at: number;
    processed_at: number | null;
    created_at: number;
    updated_at: number;
}
/**
 * Initialize the styleshoot_watch_log table. Called once at startup.
 */
export declare function initWatcherTable(): Promise<void>;
/**
 * Crash recovery: reset any folders stuck in 'uploading' status back to 'matched'
 * so they get retried on the next scan. This handles the case where the process
 * crashed mid-upload.
 */
export declare function recoverStuckUploads(): Promise<void>;
/**
 * Check if a folder has already been processed.
 */
export declare function isProcessed(folderPath: string): Promise<boolean>;
/**
 * Check if a folder already has a record (any status).
 */
export declare function hasRecord(folderPath: string): Promise<boolean>;
/**
 * Record that a new folder was detected.
 */
export declare function recordDetection(params: {
    folderName: string;
    folderPath: string;
    presetName?: string;
    productName?: string;
    serialSuffix?: string | null;
    imageCount?: number;
}): Promise<number>;
/**
 * Update the Shopify match for a watch log entry.
 */
export declare function updateMatch(id: number, shopifyProductId: string | null, shopifyProductTitle: string | null, confidence: string): Promise<void>;
/**
 * Update status to 'uploading' when we start uploading images.
 */
export declare function updateUploading(id: number): Promise<void>;
/**
 * Update status to 'done' after successful upload.
 */
export declare function updateDone(id: number, imageCount: number): Promise<void>;
/**
 * Update status to 'error' with error message.
 */
export declare function updateError(id: number, error: string): Promise<void>;
/**
 * Get all unmatched folders (for manual review).
 */
export declare function getUnmatched(): Promise<WatchLogEntry[]>;
/**
 * Get all pending folders (detected but not yet processed).
 */
export declare function getPending(): Promise<WatchLogEntry[]>;
/**
 * Get recent watch log entries.
 */
export declare function getRecent(limit?: number): Promise<WatchLogEntry[]>;
/**
 * Get watcher stats summary.
 */
export declare function getWatcherStats(): Promise<{
    total: number;
    done: number;
    unmatched: number;
    errors: number;
    pending: number;
}>;
/**
 * Manually link an unmatched folder to a Shopify product (for review UI).
 */
export declare function manualLink(id: number, shopifyProductId: string, shopifyProductTitle: string): Promise<void>;
