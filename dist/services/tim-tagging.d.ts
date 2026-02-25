export interface TagResult {
    success: boolean;
    productId: string;
    previousTag?: string;
    newTag?: string;
    skipped?: boolean;
    error?: string;
}
/**
 * Apply a condition tag to a Shopify product.
 * Removes any existing condition-* tag before adding the new one.
 * Skips tagging if condition is null.
 */
export declare function applyConditionTag(accessToken: string, productId: string, condition: string | null): Promise<TagResult>;
/**
 * Check if a product has a condition tag and return it.
 */
export declare function getConditionTagFromTags(tags: string[]): string | null;
