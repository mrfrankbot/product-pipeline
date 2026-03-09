import { refreshEbayUserToken } from './client.js';
import { getDb } from '../db/client.js';
import { authTokens } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { info, warn } from '../utils/logger.js';

const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
];

/**
 * Get a valid eBay access token, auto-refreshing if expired.
 * Returns null if no token exists or refresh fails.
 */
export const getValidEbayToken = async (): Promise<string | null> => {
  const db = await getDb();
  const row = await db
    .select()
    .from(authTokens)
    .where(eq(authTokens.platform, 'ebay'))
    .get();

  if (!row) return null;

  // Check if token is still valid (with 5 min buffer)
  const now = new Date();
  const buffer = 5 * 60 * 1000; // 5 minutes
  if (row.expiresAt && row.expiresAt.getTime() - buffer > now.getTime()) {
    return row.accessToken;
  }

  // Token expired — try to refresh
  if (!row.refreshToken) {
    warn('eBay token expired and no refresh token available. Run: ebaysync auth ebay');
    return null;
  }

  info('eBay token expired, refreshing...');
  try {
    const newToken = await refreshEbayUserToken(row.refreshToken, EBAY_SCOPES);
    const expiresAt = new Date(now.getTime() + newToken.expiresIn * 1000);

    await db
      .update(authTokens)
      .set({
        accessToken: newToken.accessToken,
        refreshToken: newToken.refreshToken ?? row.refreshToken,
        scope: newToken.scope ?? row.scope,
        expiresAt,
        updatedAt: now,
      })
      .where(eq(authTokens.platform, 'ebay'))
      .run();

    info('eBay token refreshed successfully');
    return newToken.accessToken;
  } catch (err) {
    warn(`Failed to refresh eBay token: ${err instanceof Error ? err.message : err}`);
    warn('Run: ebaysync auth ebay');
    return null;
  }
};

/**
 * Proactively refresh the eBay token on startup if it's expired or expiring soon.
 * Call this once when the server starts to avoid a failed first request.
 * Non-fatal — logs warnings but does not throw.
 */
export const warmEbayToken = async (): Promise<void> => {
  try {
    const token = await getValidEbayToken();
    if (token) {
      info('eBay token warmed successfully on startup');
    } else {
      warn('eBay token not available on startup — eBay listing will be unavailable until re-authenticated');
    }
  } catch (err) {
    warn(`eBay token warm-up failed: ${err instanceof Error ? err.message : err}`);
  }
};

/**
 * Get a valid Shopify access token.
 */
export const getValidShopifyToken = async (): Promise<string | null> => {
  const db = await getDb();
  const row = await db
    .select()
    .from(authTokens)
    .where(eq(authTokens.platform, 'shopify'))
    .get();

  return row?.accessToken ?? null;
};
