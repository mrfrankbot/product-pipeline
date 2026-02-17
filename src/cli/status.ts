import { Command } from 'commander';
import { getDb } from '../db/client.js';
import { authTokens, productMappings, orderMappings, syncLog } from '../db/schema.js';
import { eq, desc, count } from 'drizzle-orm';
import { info } from '../utils/logger.js';

export const buildStatusCommand = () => {
  const status = new Command('status').description('Overall sync health');

  status
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const db = await getDb();

      // Auth status
      const shopify = await db
        .select()
        .from(authTokens)
        .where(eq(authTokens.platform, 'shopify'))
        .get();
      const ebay = await db
        .select()
        .from(authTokens)
        .where(eq(authTokens.platform, 'ebay'))
        .get();

      const now = new Date();
      const shopifyOk = shopify && (!shopify.expiresAt || shopify.expiresAt > now);
      const ebayOk = ebay && (!ebay.expiresAt || ebay.expiresAt > now);

      // Counts
      const productCount = await db
        .select({ count: count() })
        .from(productMappings)
        .get();
      const orderCount = await db
        .select({ count: count() })
        .from(orderMappings)
        .get();

      // Recent sync activity
      const recentSyncs = await db
        .select()
        .from(syncLog)
        .orderBy(desc(syncLog.id))
        .limit(5)
        .all();

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              auth: {
                shopify: shopifyOk ? 'connected' : shopify ? 'expired' : 'missing',
                ebay: ebayOk ? 'connected' : ebay ? 'expired' : 'missing',
              },
              counts: {
                productMappings: productCount?.count ?? 0,
                orderMappings: orderCount?.count ?? 0,
              },
              recentActivity: recentSyncs.map((s) => ({
                direction: s.direction,
                type: s.entityType,
                id: s.entityId,
                status: s.status,
                detail: s.detail,
                at: s.createdAt,
              })),
            },
            null,
            2,
          ),
        );
      } else {
        info('=== ProductPipeline Status ===');
        info('');
        info(`Shopify: ${shopifyOk ? '✅ connected' : shopify ? '⚠️ expired' : '❌ not connected'}`);
        info(`eBay:    ${ebayOk ? '✅ connected' : ebay ? '⚠️ expired' : '❌ not connected'}`);
        info('');
        info(`Product mappings: ${productCount?.count ?? 0}`);
        info(`Order mappings:   ${orderCount?.count ?? 0}`);

        if (recentSyncs.length) {
          info('');
          info('Recent activity:');
          recentSyncs.forEach((s) => {
            const icon = s.status === 'success' ? '✅' : '❌';
            info(`  ${icon} ${s.direction} ${s.entityType} ${s.entityId}: ${s.detail ?? ''}`);
          });
        }
      }
    });

  return status;
};
