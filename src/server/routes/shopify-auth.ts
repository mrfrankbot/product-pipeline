import { Router, type Request, type Response } from 'express';
import { loadShopifyCredentials } from '../../config/credentials.js';
import { getRawDb } from '../../db/client.js';
import { info, error as logError } from '../../utils/logger.js';

const router = Router();

router.get('/auth', async (req: Request, res: Response) => {
  try {
    const creds = await loadShopifyCredentials();
    const shop = (req.query.shop as string) || creds.storeDomain;
    const appUrl = `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${appUrl}/auth/callback`;

    const scopes = [
      'read_products', 'write_products',
      'read_inventory', 'write_inventory',
      'read_orders', 'write_orders',
      'read_fulfillments', 'write_fulfillments',
    ].join(',');

    const nonce = crypto.randomUUID();

    const authUrl =
      `https://${shop}/admin/oauth/authorize?` +
      `client_id=${creds.clientId}` +
      `&scope=${scopes}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${nonce}`;

    info(`[Shopify Auth] Redirecting to: ${authUrl}`);
    res.redirect(authUrl);
  } catch (err) {
    logError(`[Shopify Auth] Error: ${err}`);
    res.status(500).json({ error: 'Auth initialization failed' });
  }
});

router.get('/auth/callback', async (req: Request, res: Response) => {
  try {
    const { code, shop } = req.query;
    if (!code || !shop) {
      res.status(400).json({ error: 'Missing code or shop parameter' });
      return;
    }

    const creds = await loadShopifyCredentials();

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code: code as string,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      logError(`[Shopify Auth] Token exchange failed: ${errText}`);
      res.status(500).json({ error: 'Token exchange failed' });
      return;
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string; scope: string };
    const accessToken = tokenData.access_token;

    const db = await getRawDb();
    const existing = db.prepare(`SELECT * FROM auth_tokens WHERE platform = 'shopify'`).get();

    if (existing) {
      db.prepare(
        `UPDATE auth_tokens SET access_token = ?, scope = ?, updated_at = unixepoch() WHERE platform = 'shopify'`
      ).run(accessToken, tokenData.scope);
    } else {
      db.prepare(
        `INSERT INTO auth_tokens (platform, access_token, scope, created_at, updated_at) VALUES ('shopify', ?, ?, unixepoch(), unixepoch())`
      ).run(accessToken, tokenData.scope);
    }

    info(`[Shopify Auth] Authenticated with ${shop}. Scopes: ${tokenData.scope}`);

    try {
      await registerWebhooks(shop as string, accessToken, `${req.protocol}://${req.get('host')}`);
    } catch (err) {
      logError(`[Shopify Auth] Webhook registration failed: ${err}`);
    }

    res.send(`
      <html><body style="font-family:system-ui;padding:40px;text-align:center">
        <h1>✅ EbaySync Connected!</h1>
        <p>Authenticated with ${shop}</p>
        <p>Scopes: ${tokenData.scope}</p>
        <p>You can close this window.</p>
      </body></html>
    `);
  } catch (err) {
    logError(`[Shopify Auth] Callback error: ${err}`);
    res.status(500).json({ error: 'Auth callback failed' });
  }
});

async function registerWebhooks(shop: string, accessToken: string, appUrl: string): Promise<void> {
  const topics = [
    'products/update', 'products/create', 'products/delete',
    'orders/fulfilled', 'inventory_levels/update',
  ];

  for (const topic of topics) {
    const webhookUrl = `${appUrl}/webhooks/shopify/${topic.replace('/', '-')}`;
    const response = await fetch(`https://${shop}/admin/api/2024-01/webhooks.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ webhook: { topic, address: webhookUrl, format: 'json' } }),
    });

    if (response.ok) {
      info(`[Shopify Auth] Webhook registered: ${topic} → ${webhookUrl}`);
    } else {
      const errText = await response.text();
      logError(`[Shopify Auth] Webhook failed ${topic}: ${errText}`);
    }
  }
}

export default router;
