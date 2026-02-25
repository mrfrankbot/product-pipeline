export type EbayToken = {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    tokenType: string;
    scope?: string;
};
export declare const requestEbayAppToken: (scopes: string[]) => Promise<EbayToken>;
export declare const exchangeEbayAuthCode: (code: string, redirectUri: string) => Promise<EbayToken>;
export declare const refreshEbayUserToken: (refreshToken: string, scopes: string[]) => Promise<EbayToken>;
export type EbayRequestOptions = {
    method?: string;
    path: string;
    accessToken: string;
    body?: unknown;
    headers?: Record<string, string>;
};
export declare const ebayRequest: <T>({ method, path, accessToken, body, headers, }: EbayRequestOptions) => Promise<T>;
