import { Command } from 'commander';
import ora from 'ora';
import { syncAllInventory } from '../sync/inventory-sync.js';
import { getDb } from '../db/client.js';
import { authTokens } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { error as logError } from '../utils/logger.js';
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
export const buildInventoryCommand = () => {
    const inventory = new Command('inventory').description('Inventory commands');
    inventory
        .command('sync')
        .description('Sync inventory levels from Shopify → eBay')
        .option('--dry-run', 'Preview changes without applying')
        .option('--json', 'Output as JSON')
        .action(async (opts) => {
        const spinner = ora('Syncing inventory Shopify → eBay').start();
        try {
            const ebayToken = await getToken('ebay');
            const shopifyToken = await getToken('shopify');
            const result = await syncAllInventory(ebayToken, shopifyToken, {
                dryRun: opts.dryRun,
            });
            spinner.succeed(`Inventory sync: ${result.updated} updated, ${result.skipped} unchanged, ${result.failed} failed`);
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
            if (result.errors.length) {
                logError('Errors:');
                result.errors.forEach((e) => logError(`  ${e.sku}: ${e.error}`));
            }
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Inventory sync failed');
            process.exitCode = 1;
        }
    });
    return inventory;
};
