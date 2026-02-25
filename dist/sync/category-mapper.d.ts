/**
 * Smart eBay category mapper with fuzzy matching.
 *
 * Maps Shopify product_type strings (which can be messy, e.g.
 * "camera point & shoot cameras" or "lenses slr lenses") to the correct
 * eBay category ID for UsedCameraGear store products.
 */
export interface CategoryRule {
    /** eBay category ID */
    categoryId: string;
    /** Human-readable category name */
    name: string;
    /** Keywords that trigger this category (checked against lowercased product_type) */
    keywords: string[];
    /** Priority — higher wins when multiple rules match */
    priority: number;
}
/**
 * Category rules ordered by specificity.  Higher-priority rules are checked
 * first so that "digital camera" beats the generic "camera" catch-all.
 */
export declare const CATEGORY_RULES: CategoryRule[];
/**
 * Get the eBay category ID for a Shopify product_type string.
 *
 * Uses fuzzy keyword matching: the product_type is lowercased and every
 * rule's keywords are checked for inclusion.  When multiple rules match
 * the one with the highest priority wins.
 */
export declare function getCategoryId(productType: string | null | undefined): string;
/**
 * Get human-readable category name (useful for logging / UI).
 */
export declare function getCategoryName(productType: string | null | undefined): string;
/**
 * Get both category ID and name.
 */
export declare function getCategory(productType: string | null | undefined): {
    id: string;
    name: string;
};
