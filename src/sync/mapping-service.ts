import { getDb } from '../db/client.js';
import { fieldMappings } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { warn } from '../utils/logger.js';

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
export const getMapping = async (
  mappingType: string,
  sourceValue: string | null,
): Promise<string | null> => {
  const db = await getDb();

  // First try exact match
  if (sourceValue) {
    const exactMatch = await db
      .select()
      .from(fieldMappings)
      .where(
        and(
          eq(fieldMappings.mappingType, mappingType),
          eq(fieldMappings.sourceValue, sourceValue)
        )
      )
      .get();

    if (exactMatch) {
      return exactMatch.targetValue;
    }

    // Try case-insensitive partial match for conditions/categories
    if (mappingType === 'condition' || mappingType === 'category') {
      const allMappings = await db
        .select()
        .from(fieldMappings)
        .where(eq(fieldMappings.mappingType, mappingType))
        .all();

      const partialMatch = allMappings.find(mapping => 
        mapping.sourceValue && 
        sourceValue.toLowerCase().includes(mapping.sourceValue.toLowerCase())
      );

      if (partialMatch) {
        return partialMatch.targetValue;
      }
    }
  }

  // Fall back to default mapping
  const defaultMapping = await db
    .select()
    .from(fieldMappings)
    .where(
      and(
        eq(fieldMappings.mappingType, mappingType),
        eq(fieldMappings.isDefault, true)
      )
    )
    .get();

  if (defaultMapping) {
    return defaultMapping.targetValue;
  }

  warn(`[MappingService] No mapping found for ${mappingType}:${sourceValue}, and no default`);
  return null;
};

/**
 * Map Shopify product condition tags to eBay condition values.
 */
export const mapCondition = async (tags: string[]): Promise<string> => {
  const tagStr = tags.join(',').toLowerCase();
  
  // Try each tag to find a condition mapping
  for (const tag of tags) {
    const mapped = await getMapping('condition', tag.trim());
    if (mapped) {
      return mapped;
    }
  }

  // Try the combined string
  const mapped = await getMapping('condition', tagStr);
  if (mapped) {
    return mapped;
  }

  // Fall back to default
  const defaultCondition = await getMapping('condition', null);
  return defaultCondition || 'GOOD';
};

/**
 * Map Shopify product type to eBay category ID.
 */
export const mapCategory = async (productType: string): Promise<string> => {
  const mapped = await getMapping('category', productType);
  if (mapped) {
    return mapped;
  }

  // Try partial matches on common keywords
  const keywords = productType.toLowerCase().split(/\s+/);
  for (const keyword of keywords) {
    const keywordMapped = await getMapping('category', keyword);
    if (keywordMapped) {
      return keywordMapped;
    }
  }

  // Fall back to default
  const defaultCategory = await getMapping('category', null);
  return defaultCategory || '48519'; // Other Camera Accessories
};

/**
 * Map Shopify field name to eBay field name.
 */
export const mapField = async (shopifyFieldName: string): Promise<string | null> => {
  return getMapping('field', shopifyFieldName);
};

/**
 * Get inventory location setting.
 */
export const getInventoryLocation = async (): Promise<string> => {
  const mapped = await getMapping('inventory_location', 'default');
  return mapped || 'all';
};

/**
 * Get all mappings of a specific type.
 */
export const getMappingsByType = async (mappingType: string): Promise<FieldMapping[]> => {
  const db = await getDb();
  return db
    .select()
    .from(fieldMappings)
    .where(eq(fieldMappings.mappingType, mappingType))
    .all() as FieldMapping[];
};

/**
 * Get all mappings grouped by type.
 */
export const getAllMappings = async (): Promise<Record<string, FieldMapping[]>> => {
  const db = await getDb();
  const allMappings = await db.select().from(fieldMappings).all() as FieldMapping[];
  
  const grouped: Record<string, FieldMapping[]> = {};
  for (const mapping of allMappings) {
    if (!grouped[mapping.mappingType]) {
      grouped[mapping.mappingType] = [];
    }
    grouped[mapping.mappingType].push(mapping);
  }
  
  return grouped;
};

/**
 * Create a new mapping.
 */
export const createMapping = async (
  mappingType: string,
  sourceValue: string | null,
  targetValue: string,
  isDefault: boolean = false,
): Promise<FieldMapping> => {
  const db = await getDb();
  
  // If this is set as default, unset other defaults of same type
  if (isDefault) {
    await db
      .update(fieldMappings)
      .set({ isDefault: false })
      .where(
        and(
          eq(fieldMappings.mappingType, mappingType),
          eq(fieldMappings.isDefault, true)
        )
      )
      .run();
  }
  
  const result = await db
    .insert(fieldMappings)
    .values({
      mappingType,
      sourceValue,
      targetValue,
      isDefault,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
  
  const newMapping = await db
    .select()
    .from(fieldMappings)
    .where(eq(fieldMappings.id, result.lastInsertRowid as number))
    .get() as FieldMapping;
  
  return newMapping;
};

/**
 * Update an existing mapping.
 */
export const updateMapping = async (
  id: number,
  updates: Partial<{
    sourceValue: string | null;
    targetValue: string;
    isDefault: boolean;
  }>,
): Promise<FieldMapping | null> => {
  const db = await getDb();
  
  // Get the existing mapping to check type
  const existing = await db
    .select()
    .from(fieldMappings)
    .where(eq(fieldMappings.id, id))
    .get();
  
  if (!existing) {
    return null;
  }
  
  // If setting as default, unset other defaults of same type
  if (updates.isDefault) {
    await db
      .update(fieldMappings)
      .set({ isDefault: false })
      .where(
        and(
          eq(fieldMappings.mappingType, existing.mappingType),
          eq(fieldMappings.isDefault, true)
        )
      )
      .run();
  }
  
  await db
    .update(fieldMappings)
    .set({
      ...updates,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(fieldMappings.id, id))
    .run();
  
  const updated = await db
    .select()
    .from(fieldMappings)
    .where(eq(fieldMappings.id, id))
    .get() as FieldMapping;
  
  return updated;
};

/**
 * Delete a mapping.
 */
export const deleteMapping = async (id: number): Promise<boolean> => {
  const db = await getDb();
  
  const result = await db
    .delete(fieldMappings)
    .where(eq(fieldMappings.id, id))
    .run();
  
  return result.changes > 0;
};