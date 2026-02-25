type AuthResult = {
    code: string;
    redirectUri: string;
};
/**
 * Generate the eBay consent URL for user authorization.
 */
export declare const generateConsentUrl: (appId: string, redirectUri: string, scopes: string[], state?: string) => string;
/**
 * Manual auth flow: prints consent URL, user pastes auth code from browser.
 * Works without a registered RuName by using the app's configured RuName from
 * the eBay developer portal (Chris needs to set this up once).
 */
export declare const startEbayAuthFlowManual: (scopes: string[]) => Promise<AuthResult>;
/**
 * Local server auth flow: starts a localhost callback server and opens the
 * consent page. Used when RuName points to localhost (dev/testing).
 */
export declare const startEbayAuthFlow: (scopes: string[], port?: number) => Promise<AuthResult>;
export {};
