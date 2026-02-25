import Database from 'better-sqlite3';
export declare const ensureDbPath: () => Promise<string>;
export declare const getDb: () => Promise<import("drizzle-orm/better-sqlite3").BetterSQLite3Database<Record<string, unknown>> & {
    $client: Database.Database;
}>;
/**
 * Get the raw better-sqlite3 instance for direct SQL queries.
 * Must call getDb() first to initialize.
 */
export declare const getRawDb: () => Promise<InstanceType<typeof Database>>;
