import http from 'node:http';
import * as readline from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import open from 'open';
import { loadEbayCredentials } from '../config/credentials.js';
import { info } from '../utils/logger.js';
const EBAY_AUTH_BASE = 'https://auth.ebay.com/oauth2/authorize';
/**
 * Generate the eBay consent URL for user authorization.
 */
export const generateConsentUrl = (appId, redirectUri, scopes, state) => {
    const url = new URL(EBAY_AUTH_BASE);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes.join(' '));
    if (state)
        url.searchParams.set('state', state);
    return url.toString();
};
/**
 * Manual auth flow: prints consent URL, user pastes auth code from browser.
 * Works without a registered RuName by using the app's configured RuName from
 * the eBay developer portal (Chris needs to set this up once).
 */
export const startEbayAuthFlowManual = async (scopes) => {
    const ebay = await loadEbayCredentials();
    if (!ebay.ruName) {
        throw new Error('No RuName configured. Add ru_name to ~/.clawdbot/credentials/ebay-api.txt\n' +
            'Get it from: https://developer.ebay.com/my/keys → User Tokens → RuName');
    }
    const consentUrl = generateConsentUrl(ebay.appId, ebay.ruName, scopes);
    info('');
    info('=== eBay Authorization ===');
    info('');
    info('1. Open this URL in your browser:');
    info('');
    info(`   ${consentUrl}`);
    info('');
    info('2. Sign in and grant access');
    info('3. After approval, you will be redirected. Copy the "code" parameter from the URL');
    info('4. Paste the code below');
    info('');
    // Try to open browser automatically
    try {
        await open(consentUrl);
        info('(Browser opened automatically)');
        info('');
    }
    catch {
        // Browser open is best-effort
    }
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const code = await rl.question('Paste authorization code: ');
    rl.close();
    if (!code.trim()) {
        throw new Error('No authorization code provided');
    }
    return { code: code.trim(), redirectUri: ebay.ruName };
};
/**
 * Local server auth flow: starts a localhost callback server and opens the
 * consent page. Used when RuName points to localhost (dev/testing).
 */
export const startEbayAuthFlow = async (scopes, port = 36823) => {
    const ebay = await loadEbayCredentials();
    const state = randomBytes(16).toString('hex');
    const redirectUri = ebay.ruName || `http://localhost:${port}/callback`;
    const consentUrl = generateConsentUrl(ebay.appId, redirectUri, scopes, state);
    const authCode = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const requestUrl = new URL(req.url ?? '/', `http://localhost:${port}`);
            const returnedState = requestUrl.searchParams.get('state');
            const code = requestUrl.searchParams.get('code');
            const error = requestUrl.searchParams.get('error');
            if (error) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end(`Authorization failed: ${error}`);
                server.close();
                reject(new Error(`eBay auth error: ${error}`));
                return;
            }
            if (returnedState !== state) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid state parameter.');
                server.close();
                reject(new Error('eBay auth state mismatch'));
                return;
            }
            if (!code) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Missing authorization code.');
                server.close();
                reject(new Error('Missing authorization code'));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Authorization Complete!</h1><p>You can close this window.</p></body></html>');
            server.close();
            resolve(code);
        });
        server.listen(port, () => {
            void open(consentUrl);
        });
        const timeout = setTimeout(() => {
            server.close();
            reject(new Error('Timed out waiting for eBay authorization'));
        }, 5 * 60 * 1000);
        server.on('close', () => clearTimeout(timeout));
    });
    return { code: authCode, redirectUri };
};
