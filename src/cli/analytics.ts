import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { apiGet } from './api-client.js';

export const buildAnalyticsCommand = () => {
  const analytics = new Command('analytics').description('Sales analytics & reports');

  analytics
    .command('summary')
    .description('Sales summary')
    .action(async (_opts, command) => {
      const spinner = ora('Fetching sales summary...').start();
      try {
        const data = await apiGet('/api/ebay/orders/stats');
        spinner.stop();
        if (command.optsWithGlobals().json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(chalk.bold('Sales Summary:'));
          for (const [k, v] of Object.entries(data)) {
            if (typeof v === 'object' && v !== null) {
              console.log(`  ${k}:`);
              for (const [k2, v2] of Object.entries(v as Record<string, any>)) {
                console.log(`    ${k2}: ${v2}`);
              }
            } else {
              console.log(`  ${k}: ${v}`);
            }
          }
        }
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : 'Failed');
        process.exitCode = 1;
      }
    });

  analytics
    .command('orders')
    .description('Recent eBay orders')
    .option('--limit <n>', 'Limit results', '20')
    .action(async (opts, command) => {
      const spinner = ora('Fetching orders...').start();
      try {
        const data = await apiGet('/api/ebay/orders', { limit: opts.limit });
        spinner.stop();
        if (command.optsWithGlobals().json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          const orders = data.data || data.orders || [];
          if (!orders.length) { console.log('No orders found.'); return; }
          console.log(chalk.bold(`eBay Orders (${orders.length}):`));
          for (const o of orders) {
            console.log(`  ${chalk.cyan(o.ebay_order_id || o.id)} | $${o.total || '—'} | ${o.status || '—'} | ${o.buyer_username || '—'}`);
          }
        }
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : 'Failed');
        process.exitCode = 1;
      }
    });

  return analytics;
};
