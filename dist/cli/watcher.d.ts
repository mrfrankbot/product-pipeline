/**
 * CLI commands for the StyleShoots folder watcher.
 *
 *   ebaysync watcher start [--path <dir>] [--stabilize <ms>]
 *   ebaysync watcher stop
 *   ebaysync watcher status
 */
import { Command } from 'commander';
export declare function buildWatcherCommand(): Command;
