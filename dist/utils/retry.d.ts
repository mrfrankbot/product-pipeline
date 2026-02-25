export type RetryOptions = {
    retries: number;
    delayMs: number;
    factor?: number;
};
export declare const retry: <T>(fn: () => Promise<T>, options: RetryOptions) => Promise<T>;
