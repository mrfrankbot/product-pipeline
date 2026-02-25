/**
 * eBay Listing HTML Template
 *
 * Generates a professional, branded HTML description for eBay listings.
 * Uses inline CSS only (eBay strips external stylesheets).
 */
export interface EbayTemplateParams {
    title: string;
    description: string;
    conditionGrade: string;
    conditionDescription?: string;
    includes?: string;
    price?: string;
}
/**
 * Extract the condition grade from Shopify product tags.
 */
export declare function gradeFromTags(tags: string[]): string | null;
/**
 * Extract "Includes:" section from description text.
 */
export declare function extractIncludes(description: string): string | undefined;
export declare function buildEbayDescriptionHtml(params: EbayTemplateParams): string;
