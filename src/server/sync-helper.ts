import { getValidEbayToken } from '../ebay/token-manager.js';
import { getRawDb } from '../db/client.js';
import { info, error as logError } from '../utils/logger.js';
import type { SyncResult } from '../sync/order-sync.js';

/**
 * Run order sync with automatic token retrieval.
 * Returns null if tokens aren't configured yet.
 */
export async function runOrderSync(options: { 
  dryRun?: boolean; 
  since?: string;  // ISO date to sync from (defaults to 24h ago)
} = {}): Promise<SyncResult | null> {
  try {
    const ebayToken = await getValidEbayToken();
    if (!ebayToken) {
      info('[SyncHelper] No eBay token — skipping order sync');
      return null;
    }

    const db = await getRawDb();
    const shopifyRow = db.prepare(
      `SELECT access_token FROM auth_tokens WHERE platform = 'shopify'`
    ).get() as any;

    if (!shopifyRow?.access_token) {
      info('[SyncHelper] No Shopify token — skipping order sync');
      return null;
    }

    // SAFETY: Always default to 24h ago. Core syncOrders() also enforces 7-day max lookback.
    // After the 2026-02-11 incident where all historical orders were pulled, we NEVER sync without a date filter.
    const createdAfter = options.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    info(`[SyncHelper] Syncing orders created after: ${createdAfter}`);
    
    const { syncOrders } = await import('../sync/order-sync.js');
    return await syncOrders(ebayToken, shopifyRow.access_token, { 
      ...options, 
      createdAfter 
    });
  } catch (err) {
    logError(`[SyncHelper] Order sync error: ${err}`);
    return null;
  }
}
