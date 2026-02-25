import type { SyncResult } from '../sync/order-sync.js';
/**
 * Run order sync with automatic token retrieval.
 * Returns null if tokens aren't configured yet.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ SAFETY: confirm defaults to false (DRY RUN).                           ║
 * ║ You MUST pass confirm=true to create real Shopify orders.              ║
 * ║ Duplicates cascade into Lightspeed POS — see PROJECT.md / AGENTS.md    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export declare function runOrderSync(options?: {
    /** Must be true to create real Shopify orders. Default: false (dry run). */
    confirm?: boolean;
    /** @deprecated Use confirm instead */
    dryRun?: boolean;
    /** ISO date to sync from (defaults to 24h ago, max 7-day lookback enforced) */
    since?: string;
}): Promise<SyncResult | null>;
