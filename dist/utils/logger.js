import chalk from 'chalk';
let verboseEnabled = false;
export const setVerbose = (enabled) => {
    verboseEnabled = enabled;
};
export const log = (level, message) => {
    if (level === 'debug' && !verboseEnabled)
        return;
    const prefix = level === 'info'
        ? chalk.blue('info')
        : level === 'warn'
            ? chalk.yellow('warn')
            : level === 'error'
                ? chalk.red('error')
                : chalk.gray('debug');
    console.log(`${prefix} ${message}`);
};
export const info = (message) => log('info', message);
export const warn = (message) => log('warn', message);
export const error = (message) => log('error', message);
export const debug = (message) => log('debug', message);
