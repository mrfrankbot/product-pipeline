export interface TimConditionData {
    timItemId: number;
    condition: string | null;
    conditionNotes: string | null;
    graderNotes: string | null;
    serialNumber: string | null;
    brand: string | null;
    productName: string;
    sku: string;
    itemStatus: string;
}
/**
 * Find a TIM item matching a Shopify SKU.
 * Shopify used product SKUs follow pattern: {baseSKU}-U{serialSuffix}
 * TIM items have the same SKU format.
 */
export declare function findTimItemBySku(shopifySku: string): Promise<TimConditionData | null>;
/**
 * Find TIM item for a Shopify product by looking up its variant SKUs.
 * Takes an array of variant SKUs from the Shopify product.
 */
export declare function findTimItemForProduct(variantSkus: string[]): Promise<TimConditionData | null>;
export declare function formatConditionForPrompt(data: TimConditionData): string;
