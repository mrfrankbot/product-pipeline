export interface FieldMapping {
    id: number;
    mappingType: string;
    sourceValue: string | null;
    targetValue: string;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
}
/**
 * Get mapping by type and source value, falling back to default.
 */
export declare const getMapping: (mappingType: string, sourceValue: string | null) => Promise<string | null>;
/**
 * Map Shopify product condition tags to eBay condition values.
 */
export declare const mapCondition: (tags: string[]) => Promise<string>;
/**
 * Map Shopify product type to eBay category ID.
 */
export declare const mapCategory: (productType: string) => Promise<string>;
/**
 * Map Shopify field name to eBay field name.
 */
export declare const mapField: (shopifyFieldName: string) => Promise<string | null>;
/**
 * Get inventory location setting.
 */
export declare const getInventoryLocation: () => Promise<string>;
/**
 * Get all mappings of a specific type.
 */
export declare const getMappingsByType: (mappingType: string) => Promise<FieldMapping[]>;
/**
 * Get all mappings grouped by type.
 */
export declare const getAllMappings: () => Promise<Record<string, FieldMapping[]>>;
/**
 * Create a new mapping.
 */
export declare const createMapping: (mappingType: string, sourceValue: string | null, targetValue: string, isDefault?: boolean) => Promise<FieldMapping>;
/**
 * Update an existing mapping.
 */
export declare const updateMapping: (id: number, updates: Partial<{
    sourceValue: string | null;
    targetValue: string;
    isDefault: boolean;
}>) => Promise<FieldMapping | null>;
/**
 * Delete a mapping.
 */
export declare const deleteMapping: (id: number) => Promise<boolean>;
