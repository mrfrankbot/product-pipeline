import { getValidEbayToken } from '../ebay/token-manager.js';
import { getRawDb } from '../db/client.js';
import { info, error as logError } from '../utils/logger.js';
import type { SyncResult } from '../sync/order-sync.js';

/**
 * Run order sync with automatic token retrieval.
 * Returns null if tokens aren't configured yet.
 */
export async function runOrderSync(options: { dryRun?: boolean } = {}): Promise<SyncResult | null> {
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

    const { syncOrders } = await import('../sync/order-sync.js');
    return await syncOrders(ebayToken, shopifyRow.access_token, options);
  } catch (err) {
    logError(`[SyncHelper] Order sync error: ${err}`);
    return null;
  }
}
