import { Command } from 'commander';
import chalk from 'chalk';
import { apiGet, apiPut, getServerUrl } from './api-client.js';
export const buildConfigCommand = () => {
    const config = new Command('config').description('CLI & server configuration');
    config
        .command('show')
        .description('Show current configuration')
        .action(async (_opts, command) => {
        try {
            console.log(chalk.bold('CLI Configuration:'));
            console.log(`  Server URL: ${getServerUrl()}`);
            console.log(`  (Set via SERVER_URL env variable)`);
            console.log('');
            const settings = await apiGet('/api/settings').catch(() => null);
            if (settings && command.optsWithGlobals().json) {
                console.log(JSON.stringify({ serverUrl: getServerUrl(), settings }, null, 2));
            }
            else if (settings) {
                console.log(chalk.bold('Server Settings:'));
                for (const [k, v] of Object.entries(settings)) {
                    console.log(`  ${k}: ${v}`);
                }
            }
        }
        catch (err) {
            console.error(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    config
        .command('set <key> <value>')
        .description('Update a server setting')
        .action(async (key, value, _opts, command) => {
        try {
            if (key === 'server-url') {
                console.log(`Set SERVER_URL environment variable:`);
                console.log(`  export SERVER_URL=${value}`);
                return;
            }
            const result = await apiPut('/api/settings', { [key]: value });
            console.log(`Setting ${chalk.cyan(key)} updated`);
            if (command.optsWithGlobals().json)
                console.log(JSON.stringify(result, null, 2));
        }
        catch (err) {
            console.error(err instanceof Error ? err.message : 'Failed');
            process.exitCode = 1;
        }
    });
    return config;
};
