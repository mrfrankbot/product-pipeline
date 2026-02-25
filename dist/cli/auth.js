import { Command } from 'commander';
import ora from 'ora';
import { requestShopifyClientCredentialsToken } from '../shopify/client.js';
import { exchangeEbayAuthCode } from '../ebay/client.js';
import { startEbayAuthFlow, startEbayAuthFlowManual } from '../ebay/auth.js';
import { getDb } from '../db/client.js';
import { authTokens } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { info } from '../utils/logger.js';
const EBAY_SCOPES = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.marketing',
];
const upsertToken = async (platform, token) => {
    const db = await getDb();
    const existing = await db
        .select()
        .from(authTokens)
        .where(eq(authTokens.platform, platform))
        .get();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + token.expiresIn * 1000);
    if (existing) {
        await db
            .update(authTokens)
            .set({
            accessToken: token.accessToken,
            refreshToken: token.refreshToken ?? null,
            scope: token.scope ?? null,
            expiresAt,
            updatedAt: now,
        })
            .where(eq(authTokens.platform, platform))
            .run();
    }
    else {
        await db
            .insert(authTokens)
            .values({
            platform,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken ?? null,
            scope: token.scope ?? null,
            expiresAt,
            createdAt: now,
            updatedAt: now,
        })
            .run();
    }
};
const fetchToken = async (platform) => {
    const db = await getDb();
    return db
        .select()
        .from(authTokens)
        .where(eq(authTokens.platform, platform))
        .get();
};
export const buildAuthCommand = () => {
    const auth = new Command('auth').description('Authentication commands');
    auth
        .command('shopify')
        .description('OAuth flow for Shopify access token')
        .action(async () => {
        const spinner = ora('Requesting Shopify access token').start();
        try {
            const accessToken = await requestShopifyClientCredentialsToken();
            await upsertToken('shopify', {
                accessToken,
                expiresIn: 24 * 60 * 60,
            });
            spinner.succeed('Shopify access token saved');
        }
        catch (error) {
            spinner.fail(error instanceof Error ? error.message : 'Shopify auth failed');
            process.exitCode = 1;
        }
    });
    auth
        .command('ebay')
        .description('OAuth flow for eBay user token')
        .option('--manual', 'Manual mode: paste auth code from browser (default if no RuName with localhost)')
        .option('--local', 'Local server mode: start localhost callback server')
        .action(async (opts) => {
        try {
            let code;
            let redirectUri;
            if (opts.local) {
                const spinner = ora('Starting eBay authorization (local server)').start();
                spinner.info('Waiting for eBay callback...');
                const result = await startEbayAuthFlow(EBAY_SCOPES);
                code = result.code;
                redirectUri = result.redirectUri;
            }
            else {
                // Default to manual mode
                const result = await startEbayAuthFlowManual(EBAY_SCOPES);
                code = result.code;
                redirectUri = result.redirectUri;
            }
            const spinner = ora('Exchanging auth code for token').start();
            const token = await exchangeEbayAuthCode(code, redirectUri);
            await upsertToken('ebay', {
                accessToken: token.accessToken,
                refreshToken: token.refreshToken,
                scope: token.scope,
                expiresIn: token.expiresIn,
            });
            spinner.succeed('eBay user token saved');
            info(`Token expires in ${Math.round(token.expiresIn / 3600)} hours`);
            if (token.refreshToken) {
                info('Refresh token saved — will auto-refresh when expired');
            }
        }
        catch (error) {
            console.error(error instanceof Error ? error.message : 'eBay auth failed');
            process.exitCode = 1;
        }
    });
    auth
        .command('status')
        .description('Check auth status for both platforms')
        .option('--json', 'Output as JSON')
        .action(async (opts) => {
        const shopify = await fetchToken('shopify');
        const ebay = await fetchToken('ebay');
        const now = new Date();
        const shopifyExpired = shopify?.expiresAt
            ? shopify.expiresAt < now
            : false;
        const ebayExpired = ebay?.expiresAt ? ebay.expiresAt < now : false;
        if (opts.json) {
            console.log(JSON.stringify({
                shopify: shopify
                    ? {
                        connected: true,
                        expired: shopifyExpired,
                        expiresAt: shopify.expiresAt?.toISOString(),
                    }
                    : { connected: false },
                ebay: ebay
                    ? {
                        connected: true,
                        expired: ebayExpired,
                        expiresAt: ebay.expiresAt?.toISOString(),
                        hasRefreshToken: !!ebay.refreshToken,
                    }
                    : { connected: false },
            }, null, 2));
        }
        else {
            info(`Shopify: ${shopify ? (shopifyExpired ? '⚠️ expired' : '✅ connected') : '❌ not connected'}`);
            info(`eBay:    ${ebay ? (ebayExpired ? '⚠️ expired' : '✅ connected') : '❌ not connected'}`);
            if (ebay?.refreshToken) {
                info('  ↳ Has refresh token');
            }
        }
    });
    return auth;
};
