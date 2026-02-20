import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { apiGet, getServerUrl } from './api-client.js';

export const buildHealthCommand = () => {
  const health = new Command('health')
    .description('System health check')
    .action(async (_opts, command) => {
      const spinner = ora('Checking health...').start();
      try {
        const data = await apiGet('/health');
        const status = await apiGet('/api/status').catch(() => null);
        spinner.stop();

        if (command.optsWithGlobals().json) {
          console.log(JSON.stringify({ health: data, status }, null, 2));
        } else {
          console.log(chalk.bold('ProductPipeline Health'));
          console.log(`  Server:   ${chalk.green('✓')} ${getServerUrl()}`);
          console.log(`  Status:   ${data.status}`);
          console.log(`  Uptime:   ${formatUptime(data.uptime)}`);
          if (status) {
            console.log(`  Shopify:  ${status.shopifyConnected ? chalk.green('✓ connected') : chalk.red('✗ disconnected')}`);
            console.log(`  eBay:     ${status.ebayConnected ? chalk.green('✓ connected') : chalk.red('✗ disconnected')}`);
            console.log(`  Products: ${status.products?.mapped ?? 0} mapped`);
            console.log(`  Orders:   ${status.orders?.imported ?? 0} imported`);
          }
        }
      } catch (err) {
        spinner.fail(`Server unreachable at ${getServerUrl()}`);
        if (command.optsWithGlobals().json) {
          console.log(JSON.stringify({ healthy: false, error: String(err) }, null, 2));
        }
        process.exitCode = 1;
      }
    });

  return health;
};

function formatUptime(seconds: number): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}
