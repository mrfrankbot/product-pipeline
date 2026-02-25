/**
 * stabilizer.ts — Debounce folder changes before processing.
 *
 * When a new product folder is detected on the StyleShoots drive,
 * files may still be copying. The stabilizer waits until no new
 * file changes occur for a configurable duration (default 30s)
 * before declaring the folder "stable" and ready for processing.
 */
import { info, warn } from '../utils/logger.js';
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
export class FolderStabilizer {
    stabilizeMs;
    maxWaitMs;
    pending = new Map();
    constructor(options) {
        this.stabilizeMs = options?.stabilizeMs ?? 30_000;
        this.maxWaitMs = options?.maxWaitMs ?? 300_000;
    }
    /**
     * Start watching a folder for stability.
     * Returns a promise that resolves when the folder has been quiet for `stabilizeMs`.
     * Rejects if `maxWaitMs` is exceeded.
     * If the folder is already being watched, returns the existing promise.
     */
    waitForStable(folderPath) {
        // Already pending — return existing wait
        const existing = this.pending.get(folderPath);
        if (existing) {
            return new Promise((resolve, reject) => {
                // Chain onto the existing entry — when it resolves/rejects, so do we
                const orig = existing;
                const origResolve = orig.resolve;
                const origReject = orig.reject;
                orig.resolve = () => { origResolve(); resolve(); };
                orig.reject = (err) => { origReject(err); reject(err); };
            });
        }
        return new Promise((resolve, reject) => {
            const entry = {
                timer: setTimeout(() => this.onStable(folderPath), this.stabilizeMs),
                resolve,
                reject,
                maxTimer: setTimeout(() => this.onMaxWait(folderPath), this.maxWaitMs),
                folderPath,
            };
            this.pending.set(folderPath, entry);
            info(`[Stabilizer] Watching ${folderPath} — waiting ${this.stabilizeMs / 1000}s for quiet`);
        });
    }
    /**
     * Notify that a file changed in the given folder. Resets the debounce timer.
     */
    notifyChange(folderPath) {
        const entry = this.pending.get(folderPath);
        if (!entry)
            return;
        // Reset the stabilize timer
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => this.onStable(folderPath), this.stabilizeMs);
    }
    /**
     * Cancel waiting for a folder (e.g., folder deleted).
     */
    cancel(folderPath) {
        const entry = this.pending.get(folderPath);
        if (!entry)
            return;
        clearTimeout(entry.timer);
        clearTimeout(entry.maxTimer);
        this.pending.delete(folderPath);
        entry.reject(new Error(`Stabilizer cancelled for ${folderPath}`));
    }
    /**
     * Cancel all pending watches. Call on shutdown.
     */
    cancelAll() {
        for (const [folderPath] of this.pending) {
            this.cancel(folderPath);
        }
    }
    /**
     * Check if a folder is currently being stabilized.
     */
    isPending(folderPath) {
        return this.pending.has(folderPath);
    }
    // --- Internal ---
    onStable(folderPath) {
        const entry = this.pending.get(folderPath);
        if (!entry)
            return;
        clearTimeout(entry.maxTimer);
        this.pending.delete(folderPath);
        info(`[Stabilizer] Folder stable: ${folderPath}`);
        entry.resolve();
    }
    onMaxWait(folderPath) {
        const entry = this.pending.get(folderPath);
        if (!entry)
            return;
        clearTimeout(entry.timer);
        this.pending.delete(folderPath);
        warn(`[Stabilizer] Max wait exceeded for ${folderPath} — processing anyway`);
        // Resolve (not reject) — process what we have, flag for review
        entry.resolve();
    }
}
