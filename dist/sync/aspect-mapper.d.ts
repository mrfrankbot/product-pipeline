/**
 * Dynamic eBay item specifics (aspects) mapper.
 *
 * Each eBay category requires different item specifics.  This module builds
 * the aspects object from Shopify product data, extracting what it can
 * (brand, model, focal length, etc.) and using safe fallbacks for the rest.
 */
export type Aspects = Record<string, string[]>;
export interface ShopifyProductLike {
    title?: string;
    vendor?: string;
    productType?: string;
    tags?: string | string[];
    bodyHtml?: string;
}
export interface ShopifyVariantLike {
    sku?: string;
    title?: string;
}
/**
 * Get eBay item specifics (aspects) for a given category and Shopify product.
 *
 * @param categoryId  eBay category ID (from getCategoryId)
 * @param product     Shopify product data
 * @param variant     Shopify variant data (for SKU → MPN)
 * @returns           Record of aspect name → value array
 */
export declare function getAspects(categoryId: string, product: ShopifyProductLike, variant: ShopifyVariantLike): Aspects;
