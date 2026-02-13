import { createShopifyGraphqlClient } from './client.js';
import { loadShopifyCredentials } from '../config/credentials.js';

export type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
};

export type ShopifyDetailedProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  description: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  tags: string[];
  images: Array<{
    id: string;
    url: string;
    altText?: string;
  }>;
  variants: Array<{
    id: string;
    sku: string;
    title: string;
    price: string;
    compareAtPrice?: string;
    inventoryQuantity: number;
    weight: number;
    weightUnit: string;
    requiresShipping: boolean;
  }>;
  options: Array<{
    id: string;
    name: string;
    values: string[];
  }>;
  createdAt: string;
  updatedAt: string;
};

export type ShopifyOverviewProduct = {
  id: string;
  title: string;
  status: string;
  images: Array<{
    id: string;
    src: string;
    alt?: string;
  }>;
  variants: Array<{
    id: string;
    sku: string;
    price: string;
  }>;
};

export const fetchShopifyProducts = async (accessToken: string, first = 20): Promise<ShopifyProduct[]> => {
  const client = await createShopifyGraphqlClient(accessToken);
  const query = `#graphql
    query Products($first: Int!) {
      products(first: $first) {
        edges {
          node {
            id
            title
            handle
            status
          }
        }
      }
    }
  `;

  const response = await client.request(query, {
    variables: { first },
  }) as { data?: { products?: { edges?: Array<{ node: ShopifyProduct }> } } };

  if (!response.data?.products?.edges) {
    throw new Error('Unexpected Shopify response while listing products');
  }

  return response.data.products.edges.map((edge) => edge.node);
};

/**
 * Fetch all Shopify products with enough detail for overview tables.
 */
export const fetchAllShopifyProductsOverview = async (
  accessToken: string,
): Promise<ShopifyOverviewProduct[]> => {
  const creds = await loadShopifyCredentials();
  const products: ShopifyOverviewProduct[] = [];
  let sinceId: string | undefined = undefined;

  while (true) {
    const params = new URLSearchParams();
    params.set('limit', '250');
    if (sinceId) params.set('since_id', sinceId);
    params.set('fields', 'id,title,status,images,variants');

    const url = `https://${creds.storeDomain}/admin/api/2024-01/products.json?${params.toString()}`;
    const response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      products: Array<{
        id: number;
        title: string;
        status: string;
        images: Array<{
          id: number;
          src: string;
          alt?: string;
        }>;
        variants: Array<{
          id: number;
          sku: string;
          price: string;
        }>;
      }>;
    };

    const page = data.products ?? [];
    products.push(
      ...page.map((product) => ({
        id: String(product.id),
        title: product.title,
        status: product.status,
        images: (product.images ?? []).map((img) => ({
          id: String(img.id),
          src: img.src,
          alt: img.alt,
        })),
        variants: (product.variants ?? []).map((variant) => ({
          id: String(variant.id),
          sku: variant.sku || '',
          price: variant.price,
        })),
      })),
    );

    if (page.length < 250) break;
    sinceId = String(page[page.length - 1].id);
  }

  return products;
};

/**
 * Fetch detailed product information via REST API for eBay listing creation.
 */
export const fetchDetailedShopifyProduct = async (
  accessToken: string,
  productId: string,
): Promise<ShopifyDetailedProduct | null> => {
  const creds = await loadShopifyCredentials();
  const url = `https://${creds.storeDomain}/admin/api/2024-01/products/${productId}.json`;

  const response = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': accessToken },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch product: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    product: {
      id: number;
      title: string;
      handle: string;
      status: string;
      body_html: string;
      product_type: string;
      vendor: string;
      tags: string;
      images: Array<{
        id: number;
        src: string;
        alt?: string;
      }>;
      variants: Array<{
        id: number;
        sku: string;
        title: string;
        price: string;
        compare_at_price?: string;
        inventory_quantity: number;
        weight: number;
        weight_unit: string;
        requires_shipping: boolean;
      }>;
      options: Array<{
        id: number;
        name: string;
        values: string[];
      }>;
      created_at: string;
      updated_at: string;
    };
  };

  const product = data.product;
  
  return {
    id: String(product.id),
    title: product.title,
    handle: product.handle,
    status: product.status,
    description: stripHtml(product.body_html || ''),
    descriptionHtml: product.body_html || '',
    productType: product.product_type || '',
    vendor: product.vendor || '',
    tags: product.tags ? product.tags.split(',').map(t => t.trim()) : [],
    images: product.images.map(img => ({
      id: String(img.id),
      url: img.src,
      altText: img.alt || undefined,
    })),
    variants: product.variants.map(variant => ({
      id: String(variant.id),
      sku: variant.sku || '',
      title: variant.title,
      price: variant.price,
      compareAtPrice: variant.compare_at_price || undefined,
      inventoryQuantity: variant.inventory_quantity || 0,
      weight: variant.weight || 0,
      weightUnit: variant.weight_unit || 'lb',
      requiresShipping: variant.requires_shipping !== false,
    })),
    options: product.options.map(option => ({
      id: String(option.id),
      name: option.name,
      values: option.values,
    })),
    createdAt: product.created_at,
    updatedAt: product.updated_at,
  };
};

/**
 * Fetch products with pagination via REST API.
 */
export const fetchAllShopifyProducts = async (
  accessToken: string,
  options: { limit?: number; sinceId?: string; status?: string } = {},
): Promise<ShopifyProduct[]> => {
  const creds = await loadShopifyCredentials();
  const params = new URLSearchParams();
  params.set('limit', String(options.limit || 250));
  if (options.sinceId) params.set('since_id', options.sinceId);
  if (options.status) params.set('status', options.status);

  const url = `https://${creds.storeDomain}/admin/api/2024-01/products.json?${params.toString()}`;

  const response = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': accessToken },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    products: Array<{
      id: number;
      title: string;
      handle: string;
      status: string;
    }>;
  };

  return data.products.map(product => ({
    id: String(product.id),
    title: product.title,
    handle: product.handle,
    status: product.status,
  }));
};

/**
 * Strip HTML tags for plain text description.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}
