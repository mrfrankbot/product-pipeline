import { Command } from 'commander';
import ora from 'ora';
import { syncOrders } from '../sync/order-sync.js';
import { getDb } from '../db/client.js';
import { authTokens, orderMappings } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { info, error as logError } from '../utils/logger.js';
const getToken = async (platform) => {
    const db = await getDb();
    const row = await db
        .select()
        .from(authTokens)
        .where(eq(authTokens.platform, platform))
        .get();
    if (!row)
        throw new Error(`No ${platform} auth token. Run: ebaysync auth ${platform}`);
    return row.accessToken;
};
export const buildOrdersCommand = () => {
    const orders = new Command('orders').description('Order sync commands');
    orders
        .command('sync')
        .description('Sync eBay orders to Shopify')
        .option('--since <date>', 'Only sync orders created after this date (ISO format)')
        .option('--dry-run', 'Preview what would be synced without creating orders')
        .option('--json', 'Output results as JSON')
        .action(async (opts) => {
        const spinner = ora('Syncing eBay orders to Shopify').start();
        try {
            const ebayToken = await getToken('ebay');
            const shopifyToken = await getToken('shopify');
            spinner.text = 'Fetching eBay orders...';
            const result = await syncOrders(ebayToken, shopifyToken, {
                createdAfter: opts.since,
                dryRun: opts.dryRun,
            });
            spinner.succeed(`Order sync complete: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`);
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
            if (result.errors.length) {
                logError('Errors:');
                result.errors.forEach((e) => logError(`  ${e.ebayOrderId}: ${e.error}`));
            }
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Order sync failed');
            process.exitCode = 1;
        }
    });
    orders
        .command('list')
        .description('List synced order mappings')
        .option('--limit <n>', 'Number of recent mappings', '20')
        .option('--json', 'Output as JSON')
        .action(async (opts) => {
        try {
            const db = await getDb();
            const mappings = await db
                .select()
                .from(orderMappings)
                .orderBy(desc(orderMappings.id))
                .limit(parseInt(opts.limit ?? '20'))
                .all();
            if (opts.json) {
                console.log(JSON.stringify(mappings, null, 2));
            }
            else {
                if (!mappings.length) {
                    info('No synced orders yet.');
                    return;
                }
                info(`Recent synced orders (${mappings.length}):`);
                mappings.forEach((m) => {
                    info(`  ${m.ebayOrderId} → ${m.shopifyOrderName ?? m.shopifyOrderId} (${m.status})`);
                });
            }
        }
        catch (err) {
            logError(err instanceof Error ? err.message : 'Failed to list orders');
            process.exitCode = 1;
        }
    });
    return orders;
};
