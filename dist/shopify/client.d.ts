import { type Shopify } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
export declare const createShopifyApi: () => Promise<Shopify>;
export declare const createShopifyGraphqlClient: (accessToken: string) => Promise<import("@shopify/shopify-api").GraphqlClient>;
export declare const requestShopifyClientCredentialsToken: () => Promise<string>;
