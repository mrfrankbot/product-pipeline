/**
 * ORDER SAFETY GUARDS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module provides critical safety mechanisms to prevent duplicate Shopify
 * order creation and runaway syncs.
 *
 * INCIDENT (2026-02-11): Syncing without a date filter pulled ALL historical
 * eBay orders into Shopify. These cascaded into Lightspeed POS and required
 * hours of manual cleanup. These guards ensure it NEVER happens again.
 *
 * THREE LAYERS OF PROTECTION:
 *   1. SAFETY_MODE rate limiter (1 order/10s, 5 orders/hr in safe mode)
 *   2. Dry-run default — must pass confirm=true to actually create
 *   3. Enhanced duplicate detection: DB + Shopify tag + total+date+buyer
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
/** SAFETY_MODE defaults to "safe". Set to "off" to disable rate limiting (NOT recommended). */
export declare const SAFETY_MODE: "safe" | "off";
/**
 * Assert that creating another Shopify order is permitted right now.
 * Throws `DuplicateOrderError` if the rate limit would be exceeded in safe mode.
 */
export declare function assertRateLimit(): void;
/**
 * Record a successful Shopify order creation for rate-limit tracking.
 * Must be called immediately after each successful createShopifyOrder().
 */
export declare function recordOrderCreation(): void;
/** Get current rate-limit status for diagnostics */
export declare function getRateLimitStatus(): {
    safetyMode: string;
    createdLastHour: number;
    maxPerHour: number;
    lastCreatedAt: string | null;
    nextAllowedAt: string | null;
};
/**
 * Third layer of duplicate detection: check Shopify for existing orders
 * matching the eBay order's total amount, creation date window, and buyer username.
 *
 * This catches cases where:
 *   - The order_mappings DB was cleared or corrupted
 *   - The eBay-{orderId} tag was stripped from the Shopify order
 *   - The order was created by a different app (e.g. Codisto / legacy)
 *
 * Returns the matching Shopify order if found, null otherwise.
 * Non-fatal — errors are logged and null is returned so the caller can decide.
 */
export declare function findDuplicateByTotalDateBuyer(accessToken: string, params: {
    total: string;
    createdAt: string;
    buyerUsername: string;
    ebayOrderId: string;
}): Promise<{
    id: number;
    name: string;
} | null>;
/** Thrown when a safety guard blocks order creation */
export declare class OrderSafetyError extends Error {
    constructor(message: string);
}
/** Thrown when a duplicate order is detected */
export declare class DuplicateOrderError extends Error {
    readonly existingOrderName: string;
    readonly existingOrderId: number;
    readonly detectionMethod: string;
    constructor(ebayOrderId: string, existingOrder: {
        id: number;
        name: string;
    }, detectionMethod: string);
}
