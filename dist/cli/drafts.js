import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { apiGet, apiPost } from './api-client.js';
export const buildDraftsCommand = () => {
    const drafts = new Command('drafts').description('Draft product review queue');
    drafts
        .command('list')
        .description('List draft products')
        .option('--status <status>', 'Filter by status (pending/approved/rejected)', 'pending')
        .option('--limit <n>', 'Limit results', '50')
        .action(async (opts, command) => {
        const spinner = ora('Fetching drafts...').start();
        try {
            const data = await apiGet('/api/drafts', { status: opts.status, limit: opts.limit });
            spinner.stop();
            if (command.optsWithGlobals().json) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                const items = data.data || [];
                if (!items.length) {
                    console.log(`No ${opts.status} drafts.`);
                    return;
                }
                console.log(chalk.bold(`Drafts (${opts.status}) — ${data.total} total:`));
                for (const d of items) {
                    console.log(`  ${chalk.cyan(d.id)} | ${d.shopifyTitle || d.shopifyProductId} | ${d.changeType || '—'}`);
                }
            }
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    drafts
        .command('review')
        .description('Show review queue (pending count)')
        .action(async (_opts, command) => {
        try {
            const data = await apiGet('/api/drafts/count');
            if (command.optsWithGlobals().json) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                console.log(`${chalk.bold('Pending drafts:')} ${data.count}`);
            }
        }
        catch (err) {
            console.error(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    drafts
        .command('approve <id>')
        .description('Approve a draft')
        .action(async (id, _opts, command) => {
        const spinner = ora('Approving draft...').start();
        try {
            const result = await apiPost(`/api/drafts/${id}/approve`);
            spinner.succeed(`Draft ${id} approved`);
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    drafts
        .command('reject <id>')
        .description('Reject a draft')
        .option('--reason <reason>', 'Rejection reason')
        .action(async (id, opts, command) => {
        const spinner = ora('Rejecting draft...').start();
        try {
            const body = {};
            if (opts.reason)
                body.reason = opts.reason;
            const result = await apiPost(`/api/drafts/${id}/reject`, body);
            spinner.succeed(`Draft ${id} rejected`);
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    drafts
        .command('approve-all')
        .description('Approve all pending drafts')
        .action(async (_opts, command) => {
        const spinner = ora('Approving all drafts...').start();
        try {
            const result = await apiPost('/api/drafts/approve-all');
            spinner.succeed(`Approved ${result.approved ?? 'all'} drafts`);
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            spinner.fail(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    drafts
        .command('settings')
        .description('View/update auto-publish settings')
        .option('--set <key=value>', 'Set a setting')
        .action(async (opts, command) => {
        try {
            if (opts.set) {
                const [key, ...rest] = opts.set.split('=');
                const value = rest.join('=');
                const result = await apiGet('/api/drafts/settings');
                const updated = { ...result, [key]: value };
                const res = await (await import('./api-client.js')).apiPut('/api/drafts/settings', updated);
                console.log('Settings updated');
                if (command.optsWithGlobals().json)
                    console.log(JSON.stringify(res, null, 2));
            }
            else {
                const data = await apiGet('/api/drafts/settings');
                if (command.optsWithGlobals().json) {
                    console.log(JSON.stringify(data, null, 2));
                }
                else {
                    console.log(chalk.bold('Draft Settings:'));
                    for (const [k, v] of Object.entries(data)) {
                        console.log(`  ${k}: ${v}`);
                    }
                }
            }
        }
        catch (err) {
            console.error(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    return drafts;
};
