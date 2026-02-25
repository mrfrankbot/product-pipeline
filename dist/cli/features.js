import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { apiGet, apiPost } from './api-client.js';
export const buildFeaturesCommand = () => {
    const features = new Command('features').description('Feature requests');
    features
        .command('list')
        .description('List feature requests')
        .action(async (_opts, command) => {
        const spinner = ora('Fetching feature requests...').start();
        try {
            const data = await apiGet('/api/features');
            spinner.stop();
            const items = data.data || data;
            if (command.optsWithGlobals().json) {
                console.log(JSON.stringify(items, null, 2));
            }
            else {
                if (!Array.isArray(items) || !items.length) {
                    console.log('No feature requests.');
                    return;
                }
                for (const f of items) {
                    const st = f.status === 'done' ? chalk.green('✓') : f.status === 'in-progress' ? chalk.yellow('⟳') : chalk.gray('•');
                    console.log(`  ${st} ${chalk.cyan(f.id)} | ${f.title || f.description?.slice(0, 60) || '—'} | ${f.status || '—'}`);
                }
            }
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    features
        .command('add <title>')
        .description('Submit a feature request')
        .option('--description <desc>', 'Detailed description')
        .action(async (title, opts, command) => {
        const spinner = ora('Submitting...').start();
        try {
            const body = { title };
            if (opts.description)
                body.description = opts.description;
            const result = await apiPost('/api/features', body);
            spinner.succeed(`Feature request submitted: ${result.id || ''}`);
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    return features;
};
