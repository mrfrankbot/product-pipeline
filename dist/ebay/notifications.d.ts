/**
 * Subscribe to eBay Platform Notifications.
 * Uses the Trading API SetNotificationPreferences call.
 */
export declare function subscribeToNotifications(notificationUrl: string): Promise<void>;
/**
 * Get current notification preferences from eBay.
 */
export declare function getNotificationPreferences(): Promise<string>;
/**
 * Unsubscribe from all eBay Platform Notifications.
 */
export declare function unsubscribeFromNotifications(): Promise<void>;
