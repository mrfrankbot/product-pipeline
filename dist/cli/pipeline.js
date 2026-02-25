import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { apiGet, apiPost } from './api-client.js';
export const buildPipelineCommand = () => {
    const pipeline = new Command('pipeline').description('Image processing pipeline');
    pipeline
        .command('trigger <productId>')
        .description('Trigger image pipeline for a product')
        .option('--template <id>', 'Template ID to use')
        .option('--skip-drive', 'Skip Google Drive search')
        .action(async (productId, opts, command) => {
        const spinner = ora('Triggering pipeline...').start();
        try {
            const body = {};
            if (opts.template)
                body.templateId = opts.template;
            if (opts.skipDrive)
                body.skipDrive = true;
            const result = await apiPost(`/api/pipeline/trigger/${productId}`, body);
            spinner.succeed(`Pipeline triggered — Job ID: ${chalk.cyan(result.jobId || result.id)}`);
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed to trigger pipeline');
            process.exitCode = 1;
        }
    });
    pipeline
        .command('status [jobId]')
        .description('Check pipeline job status')
        .action(async (jobId, _opts, command) => {
        const spinner = ora('Fetching pipeline status...').start();
        try {
            if (jobId) {
                const job = await apiGet(`/api/pipeline/jobs/${jobId}`);
                spinner.stop();
                const j = job.job || job;
                if (command.optsWithGlobals().json) {
                    console.log(JSON.stringify(j, null, 2));
                }
                else {
                    console.log(`Job ${chalk.cyan(j.id)}  ${statusIcon(j.status)} ${j.status}`);
                    console.log(`  Product: ${j.shopifyTitle || j.shopifyProductId}`);
                    console.log(`  Step:    ${j.currentStep || '—'}`);
                    if (j.error)
                        console.log(`  Error:   ${chalk.red(j.error)}`);
                    console.log(`  Created: ${j.createdAt}`);
                }
            }
            else {
                const data = await apiGet('/api/pipeline/jobs', { limit: '10' });
                spinner.stop();
                const jobs = data.jobs || [];
                if (command.optsWithGlobals().json) {
                    console.log(JSON.stringify(jobs, null, 2));
                }
                else {
                    if (!jobs.length) {
                        console.log('No pipeline jobs found.');
                        return;
                    }
                    for (const j of jobs) {
                        console.log(`${statusIcon(j.status)} ${chalk.cyan(j.id)} | ${j.status.padEnd(10)} | ${j.shopifyTitle || j.shopifyProductId}`);
                    }
                }
            }
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed to get status');
            process.exitCode = 1;
        }
    });
    pipeline
        .command('cancel <jobId>')
        .description('Cancel a running pipeline job')
        .action(async (jobId, _opts, command) => {
        const spinner = ora('Cancelling job...').start();
        try {
            const result = await apiPost(`/api/pipeline/jobs/${jobId}/cancel`);
            spinner.succeed(`Job ${jobId} cancelled`);
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed to cancel');
            process.exitCode = 1;
        }
    });
    pipeline
        .command('history')
        .description('Recent pipeline runs')
        .option('--limit <n>', 'Number of jobs', '20')
        .action(async (opts, command) => {
        const spinner = ora('Fetching history...').start();
        try {
            const data = await apiGet('/api/pipeline/jobs', { limit: opts.limit });
            spinner.stop();
            const jobs = data.jobs || [];
            if (command.optsWithGlobals().json) {
                console.log(JSON.stringify(jobs, null, 2));
            }
            else {
                if (!jobs.length) {
                    console.log('No pipeline history.');
                    return;
                }
                console.log(chalk.bold('Recent Pipeline Jobs:'));
                for (const j of jobs) {
                    const dur = j.completedAt ? timeDiff(j.createdAt, j.completedAt) : '—';
                    console.log(`  ${statusIcon(j.status)} ${j.id.slice(0, 8)} | ${j.status.padEnd(10)} | ${dur.padEnd(6)} | ${j.shopifyTitle || j.shopifyProductId}`);
                }
            }
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    pipeline
        .command('clear-stuck')
        .description('Clear stuck pipeline jobs')
        .action(async (_opts, command) => {
        const spinner = ora('Clearing stuck jobs...').start();
        try {
            const result = await apiPost('/api/pipeline/jobs/clear-stuck');
            spinner.succeed(`Cleared ${result.cleared ?? 0} stuck jobs`);
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    return pipeline;
};
function statusIcon(s) {
    if (s === 'completed' || s === 'success')
        return chalk.green('✓');
    if (s === 'failed' || s === 'error')
        return chalk.red('✗');
    if (s === 'running' || s === 'processing')
        return chalk.yellow('⟳');
    if (s === 'cancelled')
        return chalk.gray('⊘');
    return chalk.gray('•');
}
function timeDiff(a, b) {
    const ms = new Date(b).getTime() - new Date(a).getTime();
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60000)
        return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}
