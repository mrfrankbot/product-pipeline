/**
 * Capabilities Registry — auto-discovery system for chat and UI.
 *
 * Every feature registers itself here. The chat system prompt and the
 * frontend welcome screen pull from this registry so new features are
 * surfaced automatically.
 */
export interface Capability {
    id: string;
    name: string;
    description: string;
    category: 'shopify' | 'ebay' | 'pipeline' | 'images' | 'analytics' | 'settings';
    examplePrompts: string[];
    apiEndpoints: string[];
    addedAt: string;
    isNew?: boolean;
}
/** Register (or replace) a capability. */
export declare function registerCapability(cap: Capability): void;
/** Return every registered capability with `isNew` computed. */
export declare function getCapabilities(): Capability[];
/** Return only capabilities added in the last 7 days. */
export declare function getNewCapabilities(): Capability[];
