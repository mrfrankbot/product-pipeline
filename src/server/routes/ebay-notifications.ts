import { Router, type Request, type Response } from 'express';
import { parseStringPromise } from 'xml2js';
import { getRawDb } from '../../db/client.js';
import { info, warn, error as logError } from '../../utils/logger.js';

const router = Router();

/**
 * eBay Platform Notifications receiver.
 * eBay POSTs XML when orders are placed, items sold, etc.
 * We respond 200 immediately and process async.
 */
router.post('/webhooks/ebay/notifications', async (req: Request, res: Response) => {
  res.status(200).send('OK');

  try {
    const rawBody = req.body as string;
    const parsed = await parseStringPromise(rawBody, {
      explicitArray: false,
      ignoreAttrs: false,
    });

    const envelope = parsed?.['soapenv:Envelope'] || parsed?.['SOAP-ENV:Envelope'] || parsed;
    const body = envelope?.['soapenv:Body'] || envelope?.['SOAP-ENV:Body'] || envelope;

    const notificationType =
      body?.GetItemTransactionsResponse?.NotificationType ||
      body?.GetOrdersResponse?.NotificationType ||
      findNotificationType(parsed);

    info(`[eBay Notification] Type: ${notificationType || 'unknown'}`);

    const db = await getRawDb();
    db.prepare(
      `INSERT INTO notification_log (source, topic, message) VALUES (?, ?, ?)`
    ).run('ebay', notificationType || 'unknown', rawBody.substring(0, 10000));

    if (notificationType) {
      await handleNotification(notificationType, parsed, rawBody);
    }
  } catch (err) {
    logError(`[eBay Notification] Parse error: ${err}`);
  }
});

function findNotificationType(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.NotificationType) return obj.NotificationType;
  for (const key of Object.keys(obj)) {
    const result = findNotificationType(obj[key]);
    if (result) return result;
  }
  return null;
}

async function handleNotification(type: string, _parsed: any, _raw: string): Promise<void> {
  switch (type) {
    case 'FixedPriceTransaction':
    case 'AuctionCheckoutComplete':
    case 'ItemSold':
      info(`[eBay Notification] Order notification: ${type} — triggering order sync`);
      try {
        const { runOrderSync } = await import('../sync-helper.js');
        const result = await runOrderSync({ dryRun: false });
        info(`[eBay Notification] Order sync: ${result?.imported ?? 0} imported, ${result?.skipped ?? 0} skipped`);
      } catch (err) {
        logError(`[eBay Notification] Order sync failed: ${err}`);
      }
      break;
    case 'BestOffer':
      info(`[eBay Notification] Best offer received — logged`);
      break;
    default:
      warn(`[eBay Notification] Unhandled type: ${type}`);
  }

  const db = await getRawDb();
  db.prepare(
    `UPDATE notification_log SET processed_at = unixepoch()
     WHERE source = 'ebay' AND topic = ? AND id = (SELECT id FROM notification_log WHERE source = 'ebay' AND topic = ? ORDER BY id DESC LIMIT 1)`
  ).run(type, type);
}

export default router;
