export interface AttributeMapping {
    id: number;
    category: string;
    field_name: string;
    mapping_type: string;
    source_value: string | null;
    target_value: string | null;
    variation_mapping: string | null;
    is_enabled: boolean;
    display_order: number;
    created_at: string;
    updated_at: string;
}
export interface MappingsByCategory {
    [category: string]: AttributeMapping[];
}
/**
 * Get mapping for a specific category and field name.
 */
export declare const getMapping: (category: string, fieldName: string) => Promise<AttributeMapping | null>;
/**
 * Resolve mapping value based on mapping type and Shopify product data.
 */
export declare const resolveMapping: (mapping: AttributeMapping | null, shopifyProduct: any) => Promise<string | null>;
/**
 * Get all mappings for a specific category.
 */
export declare const getMappingsByCategory: (category: string) => Promise<AttributeMapping[]>;
/**
 * Get all mappings grouped by category.
 */
export declare const getAllMappings: () => Promise<MappingsByCategory>;
/**
 * Update a single mapping.
 */
export declare const updateMapping: (category: string, fieldName: string, updates: Partial<{
    mapping_type: string;
    source_value: string | null;
    target_value: string | null;
    variation_mapping: string | null;
    is_enabled: boolean;
}>) => Promise<AttributeMapping | null>;
/**
 * Update multiple mappings at once.
 */
export declare const updateMappingsBulk: (updates: Array<{
    category: string;
    field_name: string;
    mapping_type?: string;
    source_value?: string | null;
    target_value?: string | null;
    variation_mapping?: string | null;
    is_enabled?: boolean;
}>) => Promise<{
    updated: number;
    failed: number;
    errors: string[];
}>;
/**
 * Export all mappings as JSON.
 */
export declare const exportMappings: () => Promise<AttributeMapping[]>;
/**
 * Import mappings from JSON, updating existing ones.
 */
export declare const importMappings: (mappings: Array<Omit<AttributeMapping, "id" | "created_at" | "updated_at">>) => Promise<{
    imported: number;
    updated: number;
    errors: string[];
}>;
/**
 * Helper functions for eBay listing creation
 */
/**
 * Get condition for eBay listing based on mapping.
 */
export declare const getEbayCondition: (shopifyProduct: any) => Promise<string>;
/**
 * Get UPC/EAN for eBay listing based on mapping.
 */
export declare const getEbayUPC: (shopifyProduct: any) => Promise<string | null>;
/**
 * Get title for eBay listing based on mapping.
 */
export declare const getEbayTitle: (shopifyProduct: any) => Promise<string>;
/**
 * Get description for eBay listing based on mapping.
 */
export declare const getEbayDescription: (shopifyProduct: any) => Promise<string>;
/**
 * Get handling time for eBay listing based on mapping.
 */
export declare const getEbayHandlingTime: (shopifyProduct: any) => Promise<number>;
export interface ProductMappingOverride {
    id: number;
    shopify_product_id: string;
    category: string;
    field_name: string;
    value: string | null;
    updated_at: string;
}
export declare const getProductOverrides: (shopifyProductId: string) => Promise<ProductMappingOverride[]>;
export declare const saveProductOverride: (shopifyProductId: string, category: string, fieldName: string, value: string) => Promise<void>;
export declare const deleteProductOverride: (shopifyProductId: string, category: string, fieldName: string) => Promise<void>;
export declare const saveProductOverridesBulk: (shopifyProductId: string, overrides: Array<{
    category: string;
    field_name: string;
    value: string;
}>) => Promise<number>;
