import { Command } from 'commander';
import ora from 'ora';
import { fetchShopifyProducts } from '../shopify/products.js';
import { getDb } from '../db/client.js';
import { authTokens } from '../db/schema.js';
import { eq } from 'drizzle-orm';
const getShopifyToken = async () => {
    const db = await getDb();
    return db.select().from(authTokens).where(eq(authTokens.platform, 'shopify')).get();
};
export const buildProductsCommand = () => {
    const products = new Command('products').description('Product sync commands');
    products
        .command('list')
        .description('List Shopify products')
        .option('--limit <number>', 'Number of products to list', '20')
        .action(async (options, command) => {
        const spinner = ora('Fetching Shopify products').start();
        try {
            const token = await getShopifyToken();
            if (!token) {
                spinner.fail('Shopify auth missing. Run: ebaysync auth shopify');
                process.exitCode = 1;
                return;
            }
            const limit = Number(options.limit ?? 20);
            const items = await fetchShopifyProducts(token.accessToken, limit);
            spinner.stop();
            const outputJson = command.optsWithGlobals().json;
            if (outputJson) {
                console.log(JSON.stringify(items, null, 2));
                return;
            }
            for (const item of items) {
                console.log(`${item.id} | ${item.status} | ${item.title}`);
            }
        }
        catch (error) {
            spinner.fail(error instanceof Error ? error.message : 'Failed to list products');
            process.exitCode = 1;
        }
    });
    products
        .command('sync')
        .description('Sync Shopify products → eBay listings')
        .option('--sku <sku>', 'Sync a specific SKU')
        .action(() => {
        console.log('Product sync not implemented yet.');
    });
    return products;
};
