import { Router, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { loadCredentials } from '../../config/credentials.js';
import { generateConsentUrl } from '../../ebay/auth.js';
import { exchangeEbayAuthCode } from '../../ebay/client.js';
import { getDb } from '../../db/client.js';
import { authTokens } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { info, error as logError } from '../../utils/logger.js';

const router = Router();

const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
];

// In-memory state for CSRF protection
const pendingStates = new Map<string, { createdAt: number }>();

// Clean up stale states older than 10 minutes
const cleanupStates = () => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of pendingStates) {
    if (val.createdAt < cutoff) pendingStates.delete(key);
  }
};

/**
 * GET /ebay/auth — Redirect user to eBay consent page
 */
router.get('/ebay/auth', async (_req: Request, res: Response) => {
  try {
    cleanupStates();
    const { ebay } = await loadCredentials();

    if (!ebay.ruName) {
      res.status(500).json({
        error: 'No RuName configured. Add ru_name to eBay credentials file.',
      });
      return;
    }

    const state = randomBytes(16).toString('hex');
    pendingStates.set(state, { createdAt: Date.now() });

    const consentUrl = generateConsentUrl(ebay.appId, ebay.ruName, EBAY_SCOPES, state);
    info(`[eBay Auth] Redirecting to eBay consent page`);
    res.redirect(consentUrl);
  } catch (err) {
    logError(`[eBay Auth] Failed to start auth flow: ${err}`);
    res.status(500).json({ error: 'Failed to start eBay authorization' });
  }
});

/**
 * GET /ebay/auth/callback — eBay redirects here after user consent
 */
router.get('/ebay/auth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    const errorParam = req.query.error as string | undefined;

    if (errorParam) {
      logError(`[eBay Auth] User denied or error: ${errorParam}`);
      res.redirect('/?ebay_auth=error&reason=' + encodeURIComponent(errorParam));
      return;
    }

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing authorization code' });
      return;
    }

    // Validate state for CSRF protection
    if (state && typeof state === 'string') {
      if (!pendingStates.has(state)) {
        logError('[eBay Auth] Invalid or expired state parameter');
        res.redirect('/?ebay_auth=error&reason=invalid_state');
        return;
      }
      pendingStates.delete(state);
    }

    info('[eBay Auth] Received auth code, exchanging for token...');

    const { ebay } = await loadCredentials();
    if (!ebay.ruName) {
      res.status(500).json({ error: 'No RuName configured' });
      return;
    }

    // Exchange authorization code for user token
    const token = await exchangeEbayAuthCode(code, ebay.ruName);

    info(`[eBay Auth] Token received! Expires in ${token.expiresIn}s`);

    // Store token in database
    const db = await getDb();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + token.expiresIn * 1000);

    // Upsert: delete existing ebay token, insert new one
    await db.delete(authTokens).where(eq(authTokens.platform, 'ebay')).run();
    await db.insert(authTokens).values({
      platform: 'ebay',
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? null,
      scope: token.scope ?? null,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    }).run();

    info('[eBay Auth] eBay token stored successfully!');
    res.redirect('/?ebay_auth=success');
  } catch (err) {
    logError(`[eBay Auth] Token exchange failed: ${err}`);
    res.redirect('/?ebay_auth=error&reason=' + encodeURIComponent(
      err instanceof Error ? err.message : 'Token exchange failed'
    ));
  }
});

/**
 * GET /ebay/auth/declined — eBay redirects here if user declines
 */
router.get('/ebay/auth/declined', (_req: Request, res: Response) => {
  info('[eBay Auth] User declined authorization');
  res.redirect('/?ebay_auth=declined');
});

/**
 * GET /ebay/auth/status — Check if eBay is authenticated
 */
router.get('/ebay/auth/status', async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const row = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.platform, 'ebay'))
      .get();

    if (!row) {
      res.json({ authenticated: false, message: 'No eBay token found' });
      return;
    }

    const now = new Date();
    const expired = row.expiresAt ? row.expiresAt.getTime() < now.getTime() : false;
    const hasRefresh = !!row.refreshToken;

    res.json({
      authenticated: true,
      expired,
      hasRefreshToken: hasRefresh,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      scope: row.scope,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    logError(`[eBay Auth] Status check failed: ${err}`);
    res.status(500).json({ error: 'Failed to check eBay auth status' });
  }
});

/**
 * DELETE /ebay/auth — Revoke/clear the stored eBay token
 */
router.delete('/ebay/auth', async (_req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    db.prepare("DELETE FROM auth_tokens WHERE platform = 'ebay'").run();
    info('[eBay Auth] Token cleared successfully');
    res.json({ ok: true, message: 'eBay token cleared. Re-authorize at /ebay/auth' });
  } catch (err) {
    logError(`[eBay Auth] Failed to clear token: ${err}`);
    res.status(500).json({ error: 'Failed to clear eBay token' });
  }
});

export default router;
