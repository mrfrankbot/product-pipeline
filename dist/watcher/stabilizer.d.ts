/**
 * stabilizer.ts — Debounce folder changes before processing.
 *
 * When a new product folder is detected on the StyleShoots drive,
 * files may still be copying. The stabilizer waits until no new
 * file changes occur for a configurable duration (default 30s)
 * before declaring the folder "stable" and ready for processing.
 */
export interface StabilizerOptions {
    /** Milliseconds to wait after last file change before declaring stable. Default: 30000 (30s). */
    stabilizeMs?: number;
    /** Maximum milliseconds to wait before giving up. Default: 300000 (5 min). */
    maxWaitMs?: number;
}
/**
 * Manages debounce timers for folders being written to.
 *
 * Usage:
 *   const stabilizer = new FolderStabilizer({ stabilizeMs: 30000 });
 *   // Called when a folder is first detected:
 *   const promise = stabilizer.waitForStable(folderPath);
 *   // Called on every subsequent file change in the folder:
 *   stabilizer.notifyChange(folderPath);
 *   // When no changes happen for 30s, the promise resolves.
 *   await promise;
 */
export declare class FolderStabilizer {
    private stabilizeMs;
    private maxWaitMs;
    private pending;
    constructor(options?: StabilizerOptions);
    /**
     * Start watching a folder for stability.
     * Returns a promise that resolves when the folder has been quiet for `stabilizeMs`.
     * Rejects if `maxWaitMs` is exceeded.
     * If the folder is already being watched, returns the existing promise.
     */
    waitForStable(folderPath: string): Promise<void>;
    /**
     * Notify that a file changed in the given folder. Resets the debounce timer.
     */
    notifyChange(folderPath: string): void;
    /**
     * Cancel waiting for a folder (e.g., folder deleted).
     */
    cancel(folderPath: string): void;
    /**
     * Cancel all pending watches. Call on shutdown.
     */
    cancelAll(): void;
    /**
     * Check if a folder is currently being stabilized.
     */
    isPending(folderPath: string): boolean;
    private onStable;
    private onMaxWait;
}
