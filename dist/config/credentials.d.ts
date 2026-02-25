export type EbayCredentials = {
    appId: string;
    devId: string;
    certId: string;
    ruName?: string;
};
export type ShopifyCredentials = {
    clientId: string;
    clientSecret: string;
    storeDomain: string;
};
export type Credentials = {
    ebay: EbayCredentials;
    shopify: ShopifyCredentials;
};
declare const loadEbayCredentials: () => Promise<EbayCredentials>;
declare const loadShopifyCredentials: () => Promise<ShopifyCredentials>;
export declare const loadCredentials: () => Promise<Credentials>;
export { loadEbayCredentials, loadShopifyCredentials };
