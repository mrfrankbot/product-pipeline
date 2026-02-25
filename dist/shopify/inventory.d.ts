export interface ShopifyInventoryLevel {
    inventoryItemId: number;
    locationId: number;
    available: number;
}
/**
 * Fetch inventory levels for specific inventory item IDs.
 */
export declare const fetchInventoryLevels: (accessToken: string, inventoryItemIds: number[]) => Promise<ShopifyInventoryLevel[]>;
/**
 * Set inventory level for a specific item at a location.
 */
export declare const setInventoryLevel: (accessToken: string, inventoryItemId: number, locationId: number, available: number) => Promise<void>;
/**
 * Get all locations for the store.
 */
export declare const fetchLocations: (accessToken: string) => Promise<Array<{
    id: number;
    name: string;
    active: boolean;
}>>;
