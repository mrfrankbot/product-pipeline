/**
 * Shared API client for CLI → server communication.
 */
export declare function getServerUrl(): string;
export declare function apiGet<T = any>(path: string, params?: Record<string, string>): Promise<T>;
export declare function apiPost<T = any>(path: string, body?: any): Promise<T>;
export declare function apiPut<T = any>(path: string, body?: any): Promise<T>;
export declare function apiDelete<T = any>(path: string): Promise<T>;
