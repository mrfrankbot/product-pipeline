/**
 * CLI commands for the StyleShoots folder watcher.
 *
 *   ebaysync watcher start [--path <dir>] [--stabilize <ms>]
 *   ebaysync watcher stop
 *   ebaysync watcher status
 */
import { Command } from 'commander';
import ora from 'ora';
import { info, error as logError } from '../utils/logger.js';
export function buildWatcherCommand() {
    const watcher = new Command('watcher')
        .description('StyleShoots folder watcher — watch for new product photos');
    // ── watcher start ──────────────────────────────────────────────
    watcher
        .command('start')
        .description('Start watching for new StyleShoots product folders')
        .option('--path <dir>', 'Watch directory', '/Volumes/StyleShootsDrive/UsedCameraGear/')
        .option('--stabilize <ms>', 'Stabilization delay in milliseconds', '30000')
        .action(async (opts) => {
        const spinner = ora('Starting StyleShoots watcher...').start();
        try {
            // Initialize database first
            const { getDb } = await import('../db/client.js');
            await getDb();
            const { startWatcher, getStatus } = await import('../watcher/index.js');
            await startWatcher({
                watchPath: opts.path,
                stabilizeMs: parseInt(opts.stabilize),
            });
            const status = await getStatus();
            spinner.succeed('StyleShoots watcher started');
            info(`  Watch path: ${status.watchPath}`);
            info(`  Mount connected: ${status.mountConnected ? '✅' : '❌ (will retry)'}`);
            info(`  Stats: ${JSON.stringify(status.stats)}`);
            info('');
            info('Watching for new product folders. Press Ctrl+C to stop.');
            // Keep process alive
            await new Promise(() => { });
        }
        catch (err) {
            spinner.fail(`Failed to start watcher: ${err instanceof Error ? err.message : err}`);
            process.exitCode = 1;
        }
    });
    // ── watcher stop ───────────────────────────────────────────────
    watcher
        .command('stop')
        .description('Stop the folder watcher')
        .action(async () => {
        try {
            const { stopWatcher } = await import('../watcher/index.js');
            await stopWatcher();
            info('Watcher stopped');
        }
        catch (err) {
            logError(`Failed to stop watcher: ${err instanceof Error ? err.message : err}`);
            process.exitCode = 1;
        }
    });
    // ── watcher status ─────────────────────────────────────────────
    watcher
        .command('status')
        .description('Show watcher status and statistics')
        .action(async () => {
        try {
            // Initialize database first
            const { getDb } = await import('../db/client.js');
            await getDb();
            const { getStatus } = await import('../watcher/index.js');
            const status = await getStatus();
            info('=== StyleShoots Watcher Status ===');
            info(`  Running:    ${status.running ? '✅ Yes' : '❌ No'}`);
            info(`  Watch path: ${status.watchPath}`);
            info(`  Mount:      ${status.mountConnected ? '✅ Connected' : '❌ Disconnected'}`);
            info(`  Last scan:  ${status.lastScanTime ? new Date(status.lastScanTime).toISOString() : 'Never'}`);
            info('');
            info('=== Statistics ===');
            info(`  Total folders:  ${status.stats.total}`);
            info(`  Done:           ${status.stats.done}`);
            info(`  Unmatched:      ${status.stats.unmatched}`);
            info(`  Errors:         ${status.stats.errors}`);
            info(`  Pending:        ${status.stats.pending}`);
        }
        catch (err) {
            logError(`Failed to get status: ${err instanceof Error ? err.message : err}`);
            process.exitCode = 1;
        }
    });
    return watcher;
}
