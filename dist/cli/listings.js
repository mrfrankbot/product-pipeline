import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { apiGet, apiPost } from './api-client.js';
export const buildListingsCommand = () => {
    const listings = new Command('listings').description('eBay listing management');
    listings
        .command('list')
        .description('List eBay listings')
        .option('--limit <n>', 'Limit results', '50')
        .option('--search <query>', 'Search by title/SKU')
        .option('--status <status>', 'Filter by status')
        .action(async (opts, command) => {
        const spinner = ora('Fetching listings...').start();
        try {
            const params = { limit: opts.limit };
            if (opts.search)
                params.search = opts.search;
            if (opts.status)
                params.status = opts.status;
            const data = await apiGet('/api/listings', params);
            spinner.stop();
            if (command.optsWithGlobals().json) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                const items = data.data || [];
                if (!items.length) {
                    console.log('No listings found.');
                    return;
                }
                console.log(chalk.bold(`Listings (${data.total} total):`));
                for (const l of items) {
                    const st = l.status === 'active' ? chalk.green(l.status) : chalk.yellow(l.status || '—');
                    console.log(`  ${l.shopify_sku || '—'} | ${st} | ${l.shopify_title || l.shopify_product_id}`);
                }
            }
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    listings
        .command('stale')
        .description('Show stale listings needing attention')
        .action(async (_opts, command) => {
        const spinner = ora('Checking stale listings...').start();
        try {
            const data = await apiGet('/api/listings/stale');
            spinner.stop();
            if (command.optsWithGlobals().json) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                const items = data.data || data.listings || [];
                if (!items.length) {
                    console.log(chalk.green('No stale listings!'));
                    return;
                }
                console.log(chalk.bold(`Stale Listings (${items.length}):`));
                for (const l of items) {
                    console.log(`  ${chalk.yellow('⚠')} ${l.shopify_sku || l.sku || '—'} | ${l.shopify_title || l.title || '—'} | ${l.reason || '—'}`);
                }
            }
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    listings
        .command('health')
        .description('Listing health check')
        .action(async (_opts, command) => {
        const spinner = ora('Running health check...').start();
        try {
            const data = await apiGet('/api/listings/health');
            spinner.stop();
            if (command.optsWithGlobals().json) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                console.log(chalk.bold('Listing Health:'));
                for (const [k, v] of Object.entries(data)) {
                    console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
                }
            }
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    listings
        .command('republish')
        .description('Republish stale listings')
        .option('--dry-run', 'Preview without applying')
        .action(async (opts, command) => {
        const spinner = ora(opts.dryRun ? 'Previewing republish...' : 'Republishing stale listings...').start();
        try {
            const body = {};
            if (opts.dryRun)
                body.dryRun = true;
            const result = await apiPost('/api/listings/republish-stale', body);
            spinner.succeed(`Republished ${result.republished ?? result.count ?? 0} listings`);
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    listings
        .command('price-drops')
        .description('Apply price drops to eligible listings')
        .option('--dry-run', 'Preview without applying')
        .action(async (opts, command) => {
        const spinner = ora(opts.dryRun ? 'Previewing price drops...' : 'Applying price drops...').start();
        try {
            const body = {};
            if (opts.dryRun)
                body.dryRun = true;
            const result = await apiPost('/api/listings/apply-price-drops', body);
            spinner.succeed(`Price drops applied to ${result.updated ?? result.count ?? 0} listings`);
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    listings
        .command('promote')
        .description('Promote listings')
        .action(async (_opts, command) => {
        const spinner = ora('Promoting listings...').start();
        try {
            const result = await apiPost('/api/listings/promote');
            spinner.succeed('Listings promoted');
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    return listings;
};
