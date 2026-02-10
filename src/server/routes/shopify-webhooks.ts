import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { getRawDb } from '../../db/client.js';
import { info, warn, error as logError } from '../../utils/logger.js';
import { loadShopifyCredentials } from '../../config/credentials.js';

const router = Router();

async function verifyShopifyWebhook(req: Request): Promise<boolean> {
  try {
    const creds = await loadShopifyCredentials();
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    if (!hmacHeader) return false;

    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      warn('[Shopify Webhook] No raw body for HMAC verification');
      return true;
    }

    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const hash = crypto
      .createHmac('sha256', creds.clientSecret)
      .update(bodyStr, 'utf8')
      .digest('base64');

    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

router.post('/webhooks/shopify/:topic', async (req: Request, res: Response) => {
  const rawTopic = req.params.topic || req.get('X-Shopify-Topic') || 'unknown';
  const topic = Array.isArray(rawTopic) ? rawTopic[0] : rawTopic;

  res.status(200).send('OK');

  const isValid = await verifyShopifyWebhook(req);
  if (!isValid) {
    warn(`[Shopify Webhook] HMAC verification failed: ${topic}`);
  }

  const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  info(`[Shopify Webhook] Received: ${topic}`);

  try {
    const db = await getRawDb();
    db.prepare(
      `INSERT INTO notification_log (source, topic, payload, status, createdAt) VALUES (?, ?, ?, ?, datetime('now'))`
    ).run('shopify', topic, payload.substring(0, 10000), 'received');
  } catch (err) {
    logError(`[Shopify Webhook] Log error: ${err}`);
  }

  try {
    await handleShopifyWebhook(topic, req.body);
  } catch (err) {
    logError(`[Shopify Webhook] Handler error for ${topic}: ${err}`);
  }
});

async function handleShopifyWebhook(topic: string, body: any): Promise<void> {
  switch (topic) {
    case 'products/update':
    case 'products-update':
      info(`[Shopify Webhook] Product updated: ${body?.id}`);
      break;
    case 'products/create':
    case 'products-create':
      info(`[Shopify Webhook] New product: ${body?.title} (${body?.id})`);
      break;
    case 'products/delete':
    case 'products-delete':
      info(`[Shopify Webhook] Product deleted: ${body?.id}`);
      break;
    case 'orders/fulfilled':
    case 'orders-fulfilled':
      info(`[Shopify Webhook] Order fulfilled: ${body?.name} (${body?.id})`);
      break;
    case 'inventory_levels/update':
    case 'inventory_levels-update':
      info(`[Shopify Webhook] Inventory updated: item ${body?.inventory_item_id}, available: ${body?.available}`);
      break;
    default:
      warn(`[Shopify Webhook] Unhandled: ${topic}`);
  }
}

export default router;
