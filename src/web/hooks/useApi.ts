import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAppStore } from '../store';

export interface StatusResponse {
  status: string;
  products: { mapped: number };
  orders: { imported: number };
  lastSyncs: Array<Record<string, unknown>>;
  settings: Record<string, string>;
  uptime: number;
  inventory?: { synced?: number };
  revenue?: { total?: number; today?: number };
  shopifyConnected?: boolean;
  ebayConnected?: boolean;
}

export interface LogEntry {
  id: number | string;
  source?: string;
  topic?: string;
  status?: string;
  created_at?: string;
  createdAt?: string;
  payload?: string;
  message?: string;
  detail?: string;
}

export interface ListingItem {
  id: number | string;
  shopify_product_id?: string;
  ebay_listing_id?: string;
  status?: string;
  price?: number;
  last_synced?: string;
  updated_at?: string;
  created_at?: string;
  shopifyProductId?: string;
  ebayListingId?: string;
  lastSynced?: string;
  updatedAt?: string;
}

export interface OrderItem {
  id: number | string;
  ebay_order_id?: string;
  shopify_order_id?: string;
  status?: string;
  total?: number;
  created_at?: string;
  shopifyOrderId?: string;
  ebayOrderId?: string;
  createdAt?: string;
}

export interface AttributeMapping {
  category: string;
  field_name: string;
  mapping_type: 'shopify_field' | 'constant' | 'formula' | 'edit_in_grid';
  source_value: string | null;
  target_value: string | null;
  variation_mapping: string | null;
  is_enabled: boolean;
  display_order: number;
}

export interface MappingsResponse {
  sales: AttributeMapping[];
  listing: AttributeMapping[];
  payment: AttributeMapping[];
  shipping: AttributeMapping[];
}

export interface ListingsResponse {
  data: ListingItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface OrdersResponse {
  data: OrderItem[];
  total: number;
  limit: number;
  offset: number;
}

class ApiClient {
  private baseUrl = '/api';

  private async request<T>(endpoint: string, options: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    const text = await response.text();
    let payload: unknown = undefined;

    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const message =
        typeof payload === 'object' && payload !== null && 'error' in payload
          ? String((payload as { error?: string }).error)
          : typeof payload === 'string'
            ? payload
            : `Request failed with status ${response.status}`;
      throw new Error(message);
    }

    return payload as T;
  }

  get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();

export const useStatus = () => {
  const { setConnectionStatus } = useAppStore();

  const query = useQuery({
    queryKey: ['status'],
    queryFn: () => apiClient.get<StatusResponse>('/status'),
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!query.data) return;
    if (typeof query.data.shopifyConnected === 'boolean') {
      setConnectionStatus('shopify', query.data.shopifyConnected);
    }
    if (typeof query.data.ebayConnected === 'boolean') {
      setConnectionStatus('ebay', query.data.ebayConnected);
    }
  }, [query.data, setConnectionStatus]);

  return query;
};

export const useListings = (params?: {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
}) => {
  return useQuery({
    queryKey: ['listings', params],
    queryFn: () => {
      const searchParams = new URLSearchParams();
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.offset) searchParams.set('offset', String(params.offset));
      if (params?.search) searchParams.set('search', params.search);
      if (params?.status) searchParams.set('status', params.status);
      const query = searchParams.toString();
      return apiClient.get<ListingsResponse>(`/listings${query ? `?${query}` : ''}`);
    },
    placeholderData: keepPreviousData,
  });
};

export const useOrders = (params?: {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}) => {
  return useQuery({
    queryKey: ['orders', params],
    queryFn: () => {
      const searchParams = new URLSearchParams();
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.offset) searchParams.set('offset', String(params.offset));
      if (params?.search) searchParams.set('search', params.search);
      if (params?.status) searchParams.set('status', params.status);
      if (params?.startDate) searchParams.set('startDate', params.startDate);
      if (params?.endDate) searchParams.set('endDate', params.endDate);
      const query = searchParams.toString();
      return apiClient.get<OrdersResponse>(`/orders${query ? `?${query}` : ''}`);
    },
    placeholderData: keepPreviousData,
  });
};

export const useMappings = () => {
  return useQuery({
    queryKey: ['mappings'],
    queryFn: () => apiClient.get<MappingsResponse>('/mappings'),
    staleTime: 60000,
  });
};

export const useSettings = () => {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.get<Record<string, string>>('/settings'),
    staleTime: 60000,
  });
};

export const useLogs = (limit = 100) => {
  return useQuery({
    queryKey: ['logs', limit],
    queryFn: () => apiClient.get<{ data: LogEntry[] }>(`/logs?limit=${limit}`),
    refetchInterval: 20000,
  });
};

export interface ListingHealthData {
  totalActive: number;
  totalEnded: number;
  ageBuckets: Record<'0-7d' | '7-14d' | '14-30d' | '30d+', number>;
  averageDaysListed: number;
  priceDropped: number;
  republished: number;
  promoted: number;
  revenue: number;
}

export const useListingHealth = () => {
  return useQuery({
    queryKey: ['listings-health'],
    queryFn: () => apiClient.get<ListingHealthData>('/listings/health'),
    staleTime: 60000,
  });
};

export const useUpdateMapping = () => {
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();

  return useMutation({
    mutationFn: (variables: {
      category: string;
      fieldName: string;
      updates: Partial<AttributeMapping>;
    }) => apiClient.put(`/mappings/${variables.category}/${variables.fieldName}`, variables.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mappings'] });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'Failed to update mapping',
        message: error instanceof Error ? error.message : 'Unknown error',
        autoClose: 8000,
      });
    },
  });
};

export const useBulkUpdateMappings = () => {
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();

  return useMutation({
    mutationFn: (mappings: AttributeMapping[]) => apiClient.post('/mappings/bulk', { mappings }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mappings'] });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'Failed to update mappings',
        message: error instanceof Error ? error.message : 'Unknown error',
        autoClose: 8000,
      });
    },
  });
};

export const useSyncProducts = () => {
  const queryClient = useQueryClient();
  const { addNotification, addSyncOperation, removeSyncOperation } = useAppStore();

  return useMutation({
    mutationFn: (productIds?: string[]) => {
      addSyncOperation('products');
      return apiClient.post('/sync/products', { productIds: productIds ?? [] });
    },
    onSuccess: () => {
      removeSyncOperation('products');
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
      addNotification({
        type: 'success',
        title: 'Product sync started',
        autoClose: 4000,
      });
    },
    onError: (error) => {
      removeSyncOperation('products');
      addNotification({
        type: 'error',
        title: 'Product sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        autoClose: 8000,
      });
    },
  });
};

export const useSyncOrders = () => {
  const queryClient = useQueryClient();
  const { addNotification, addSyncOperation, removeSyncOperation } = useAppStore();

  return useMutation({
    mutationFn: () => {
      addSyncOperation('orders');
      return apiClient.post('/sync/trigger', { scope: 'orders' });
    },
    onSuccess: () => {
      removeSyncOperation('orders');
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
      addNotification({
        type: 'success',
        title: 'Order sync started',
        autoClose: 4000,
      });
    },
    onError: (error) => {
      removeSyncOperation('orders');
      addNotification({
        type: 'error',
        title: 'Order sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        autoClose: 8000,
      });
    },
  });
};

export const useSyncInventory = () => {
  const queryClient = useQueryClient();
  const { addNotification, addSyncOperation, removeSyncOperation } = useAppStore();

  return useMutation({
    mutationFn: () => {
      addSyncOperation('inventory');
      return apiClient.post('/sync/inventory');
    },
    onSuccess: () => {
      removeSyncOperation('inventory');
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
      addNotification({
        type: 'success',
        title: 'Inventory sync started',
        autoClose: 4000,
      });
    },
    onError: (error) => {
      removeSyncOperation('inventory');
      addNotification({
        type: 'error',
        title: 'Inventory sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        autoClose: 8000,
      });
    },
  });
};

export const useUpdateSettings = () => {
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();

  return useMutation({
    mutationFn: (settings: Record<string, string | number | boolean>) =>
      apiClient.put('/settings', settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      addNotification({
        type: 'success',
        title: 'Settings saved',
        autoClose: 4000,
      });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'Failed to save settings',
        message: error instanceof Error ? error.message : 'Unknown error',
        autoClose: 8000,
      });
    },
  });
};

export const useEbayAuthStatus = () => {
  return useQuery({
    queryKey: ['ebay-auth-status'],
    queryFn: () => apiClient.get<{ connected: boolean; user?: string; tokenExpires?: string }>('/ebay/auth/status'),
    refetchInterval: 30000,
  });
};
