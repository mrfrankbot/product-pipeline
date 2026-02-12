import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// Chat message interface
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  commandResult?: any;
  error?: string;
}

// Global app state
interface AppStore {
  // UI State
  sidebarOpen: boolean;
  chatOpen: boolean;
  syncStatus: 'idle' | 'syncing' | 'error';
  
  // Chat State
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  
  // Sync State  
  activeSyncOperations: string[];
  lastSyncTime: Date | null;
  
  // Connection Status
  shopifyConnected: boolean;
  ebayConnected: boolean;
  
  // Notifications
  notifications: Notification[];
  
  // Actions
  toggleSidebar: () => void;
  toggleChat: () => void;
  setSyncStatus: (status: 'idle' | 'syncing' | 'error') => void;
  addSyncOperation: (operation: string) => void;
  removeSyncOperation: (operation: string) => void;
  setConnectionStatus: (platform: 'shopify' | 'ebay', connected: boolean) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  
  // Chat Actions
  addChatMessage: (message: Omit<ChatMessage, 'id'>) => void;
  setChatLoading: (loading: boolean) => void;
  clearChatHistory: () => void;
}

interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  timestamp: Date;
  autoClose?: number; // milliseconds
}

export const useAppStore = create<AppStore>()(subscribeWithSelector((set) => ({
    // Initial state
    sidebarOpen: true,
    chatOpen: false,
    syncStatus: 'idle',
    chatMessages: [
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Hi! I\'m your eBay Sync assistant. I can help you sync products, check status, manage orders, and much more. Try commands like:\n\n• "sync all products"\n• "show status"\n• "check stale listings"\n• "sync orders"\n• "apply price drops"',
        timestamp: new Date(),
      }
    ],
    chatLoading: false,
    activeSyncOperations: [],
    lastSyncTime: null,
    shopifyConnected: false,
    ebayConnected: false,
    notifications: [],
    
    // Actions
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    
    toggleChat: () => set((state) => ({ chatOpen: !state.chatOpen })),
    
    setSyncStatus: (status) => {
      set({ syncStatus: status });
      if (status === 'idle') {
        set({ lastSyncTime: new Date() });
      }
    },
    
    addSyncOperation: (operation) =>
      set((state) => ({
        activeSyncOperations: [...state.activeSyncOperations, operation],
        syncStatus: 'syncing',
      })),
    
    removeSyncOperation: (operation) =>
      set((state) => {
        const newOperations = state.activeSyncOperations.filter(op => op !== operation);
        return {
          activeSyncOperations: newOperations,
          syncStatus: newOperations.length > 0 ? 'syncing' : 'idle',
        };
      }),
    
    setConnectionStatus: (platform, connected) =>
      set((state) => ({
        [platform === 'shopify' ? 'shopifyConnected' : 'ebayConnected']: connected,
      })),
    
    addNotification: (notification) =>
      set((state) => ({
        notifications: [
          {
            ...notification,
            id: Math.random().toString(36).substr(2, 9),
            timestamp: new Date(),
          },
          ...state.notifications,
        ],
      })),
    
    removeNotification: (id) =>
      set((state) => ({
        notifications: state.notifications.filter(n => n.id !== id),
      })),
    
    clearNotifications: () => set({ notifications: [] }),
    
    // Chat Actions
    addChatMessage: (message) =>
      set((state) => ({
        chatMessages: [
          ...state.chatMessages,
          {
            ...message,
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          },
        ],
      })),
    
    setChatLoading: (loading) => set({ chatLoading: loading }),
    
    clearChatHistory: () => set({ 
      chatMessages: [
        {
          id: 'welcome',
          role: 'assistant',
          content: 'Chat history cleared. How can I help you?',
          timestamp: new Date(),
        }
      ]
    }),
  })));