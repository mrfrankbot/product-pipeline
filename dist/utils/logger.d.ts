export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export declare const setVerbose: (enabled: boolean) => void;
export declare const log: (level: LogLevel, message: string) => void;
export declare const info: (message: string) => void;
export declare const warn: (message: string) => void;
export declare const error: (message: string) => void;
export declare const debug: (message: string) => void;
