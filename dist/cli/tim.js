import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { apiGet, apiPost } from './api-client.js';
export const buildTimCommand = () => {
    const tim = new Command('tim').description('TradeInManager integration');
    tim
        .command('items')
        .description('List TIM items')
        .option('--refresh', 'Force refresh from TIM')
        .action(async (opts, command) => {
        const spinner = ora('Fetching TIM items...').start();
        try {
            const params = {};
            if (opts.refresh)
                params.refresh = 'true';
            const data = await apiGet('/api/tim/items', params);
            spinner.stop();
            if (command.optsWithGlobals().json) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                const items = data.data || [];
                console.log(chalk.bold(`TIM Items (${items.length}):`));
                for (const item of items.slice(0, 50)) {
                    console.log(`  ${item.sku || '—'} | ${item.title || item.name || '—'} | ${item.condition || '—'}`);
                }
                if (items.length > 50)
                    console.log(`  ... and ${items.length - 50} more`);
            }
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    tim
        .command('condition <productId>')
        .description('Get TIM condition data for a Shopify product')
        .action(async (productId, _opts, command) => {
        const spinner = ora('Looking up condition...').start();
        try {
            const data = await apiGet(`/api/tim/condition/${productId}`);
            spinner.stop();
            if (command.optsWithGlobals().json) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                console.log(chalk.bold('TIM Condition:'));
                for (const [k, v] of Object.entries(data)) {
                    if (typeof v !== 'object')
                        console.log(`  ${k}: ${v}`);
                }
                if (data.match) {
                    console.log(`  ${chalk.green('Match found:')} ${data.match.title || data.match.sku}`);
                    console.log(`  Condition: ${data.match.condition || '—'}`);
                }
            }
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    tim
        .command('tag <productId>')
        .description('Apply TIM condition tag to a Shopify product')
        .action(async (productId, _opts, command) => {
        const spinner = ora('Applying condition tag...').start();
        try {
            const result = await apiPost(`/api/tim/tag/${productId}`);
            spinner.succeed('Condition tag applied');
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    return tim;
};
