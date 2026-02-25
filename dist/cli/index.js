import { Command } from 'commander';
import ora from 'ora';
import { buildAuthCommand } from './auth.js';
import { buildProductsCommand } from './products.js';
import { buildOrdersCommand } from './orders.js';
import { buildInventoryCommand } from './inventory.js';
import { buildStatusCommand } from './status.js';
import { buildWatcherCommand } from './watcher.js';
import { buildPipelineCommand } from './pipeline.js';
import { buildDraftsCommand } from './drafts.js';
import { buildImagesCommand } from './images.js';
import { buildListingsCommand } from './listings.js';
import { buildAnalyticsCommand } from './analytics.js';
import { buildTimCommand } from './tim.js';
import { buildHealthCommand } from './health.js';
import { buildConfigCommand } from './config.js';
import { buildFeaturesCommand } from './features.js';
import { setVerbose } from '../utils/logger.js';
import { syncOrders } from '../sync/order-sync.js';
import { syncAllInventory } from '../sync/inventory-sync.js';
// import { syncPrices } from '../sync/price-sync.js';
// import { syncFulfillments } from '../sync/fulfillment-sync.js';
import { getValidEbayToken } from '../ebay/token-manager.js';
import { info, error as logError } from '../utils/logger.js';
const program = new Command();
program
    .name('ebaysync')
    .description('ProductPipeline — Shopify ↔ eBay product management CLI')
    .version('0.2.0')
    .option('--json', 'JSON output')
    .option('--dry-run', 'Preview changes without applying')
    .option('--verbose', 'Detailed logging');
program.hook('preAction', (command) => {
    const options = command.opts();
    setVerbose(Boolean(options.verbose));
});
// Top-level sync command — runs all sync operations
program
    .command('sync')
    .description('Run full sync: orders (eBay→Shopify) + inventory (Shopify→eBay)')
    .option('--since <date>', 'Only sync orders/changes after this date')
    .option('--dry-run', 'Preview changes without applying')
    .option('--json', 'Output as JSON')
    .option('--watch <minutes>', 'Poll continuously every N minutes')
    .action(async (opts) => {
    const runSync = async () => {
        const ebayToken = await getValidEbayToken();
        // Get Shopify token from DB
        const { getDb } = await import('../db/client.js');
        const { authTokens } = await import('../db/schema.js');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        const shopifyRow = await db
            .select()
            .from(authTokens)
            .where(eq(authTokens.platform, 'shopify'))
            .get();
        const shopifyToken = shopifyRow?.accessToken;
        if (!shopifyToken) {
            logError('Shopify not connected. Run: ebaysync auth shopify');
            process.exitCode = 1;
            return;
        }
        if (!ebayToken) {
            logError('eBay not connected. Run: ebaysync auth ebay');
            process.exitCode = 1;
            return;
        }
        info('=== Full Sync ===');
        info(`  ${new Date().toISOString()}`);
        info('');
        // 1. Order sync (eBay → Shopify)
        const orderSpinner = ora('Step 1/4: Syncing eBay orders → Shopify').start();
        try {
            const orderResult = await syncOrders(ebayToken, shopifyToken, {
                createdAfter: opts.since,
                dryRun: opts.dryRun,
            });
            orderSpinner.succeed(`Orders: ${orderResult.imported} imported, ${orderResult.skipped} skipped, ${orderResult.failed} failed`);
        }
        catch (err) {
            orderSpinner.fail(`Order sync error: ${err instanceof Error ? err.message : err}`);
        }
        // 2. Inventory sync (Shopify → eBay)
        const invSpinner = ora('Step 2/3: Syncing inventory Shopify → eBay').start();
        try {
            const invResult = await syncAllInventory(ebayToken, shopifyToken, {
                dryRun: opts.dryRun,
            });
            invSpinner.succeed(`Inventory: ${invResult.updated} updated, ${invResult.skipped} unchanged, ${invResult.failed} failed`);
        }
        catch (err) {
            invSpinner.fail(`Inventory sync error: ${err instanceof Error ? err.message : err}`);
        }
        // 3. Fulfillment sync via webhooks (real-time)
        info('Step 3/3: Fulfillment sync runs via Shopify webhooks (real-time)');
        info('');
        info('Sync complete.');
    };
    await runSync();
    // Watch mode — poll continuously
    if (opts.watch) {
        const intervalMin = parseInt(opts.watch) || 15;
        info(`\nWatch mode: polling every ${intervalMin} minutes. Ctrl+C to stop.`);
        setInterval(runSync, intervalMin * 60 * 1000);
        // Keep process alive
        await new Promise(() => { });
    }
});
program.addCommand(buildAuthCommand());
program.addCommand(buildProductsCommand());
program.addCommand(buildOrdersCommand());
program.addCommand(buildInventoryCommand());
program.addCommand(buildStatusCommand());
program.addCommand(buildWatcherCommand());
program.addCommand(buildPipelineCommand());
program.addCommand(buildDraftsCommand());
program.addCommand(buildImagesCommand());
program.addCommand(buildListingsCommand());
program.addCommand(buildAnalyticsCommand());
program.addCommand(buildTimCommand());
program.addCommand(buildHealthCommand());
program.addCommand(buildConfigCommand());
program.addCommand(buildFeaturesCommand());
program.parseAsync().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
