import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  ButtonGroup,
  Card,
  Filters,
  IndexTable,
  Layout,
  Page,
  Pagination,
  Spinner,
  Text,
  TextField,
  Modal,
  Toast,
  Divider,
  Box,
  InlineStack,
  BlockStack,
} from '@shopify/polaris';
import {
  RefreshCw,
  Search,
  Filter,
  Download,
  Upload,
  ExternalLink,
  Edit,
  Trash2,
  Link,
  Unlink,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  TrendingUp,
  Package,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store';
import StatusIndicator from '../components/StatusIndicator';

interface Listing {
  id: number;
  shopifyProductId: string;
  shopifyProductHandle?: string;
  shopifyTitle?: string;
  shopifySku?: string;
  ebayListingId: string;
  ebayItemId?: string;
  ebayTitle?: string;
  ebayInventoryItemId?: string | null;
  status: 'synced' | 'pending' | 'error' | 'stale' | 'active' | 'inactive';
  healthScore?: number;
  lastSynced?: string;
  price?: number;
  quantity?: number;
  views?: number;
  watchers?: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

interface ListingsResponse {
  data: Listing[];
  total: number;
  limit: number;
  offset: number;
}

interface ListingHealth {
  listingId: string;
  score: number;
  issues: string[];
  recommendations: string[];
}

interface StaleListing {
  listingId: string;
  reason: string;
  daysStale: number;
}

// API helper functions
const api = {
  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`/api${endpoint}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  },
  
  async post<T>(endpoint: string, data?: any): Promise<T> {
    const response = await fetch(`/api${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  },
  
  async put<T>(endpoint: string, data?: any): Promise<T> {
    const response = await fetch(`/api${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  },
};

const formatTimestamp = (value?: number | string | null) => {
  if (!value) return '—';
  
  let date: Date;
  if (typeof value === 'number') {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    date = new Date(ms);
  } else {
    date = new Date(value);
  }
  
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const getStatusBadge = (status: string, healthScore?: number) => {
  const normalized = status?.toLowerCase();
  
  if (normalized === 'synced' || normalized === 'active') {
    const tone = healthScore && healthScore < 70 ? 'warning' : 'success';
    return <Badge tone={tone}>{status}</Badge>;
  }
  if (normalized === 'pending') {
    return <Badge tone="info">Pending</Badge>;
  }
  if (normalized === 'error' || normalized === 'failed') {
    return <Badge tone="critical">Error</Badge>;
  }
  if (normalized === 'stale') {
    return <Badge tone="warning">Stale</Badge>;
  }
  if (normalized === 'inactive') {
    return <Badge tone="warning">Inactive</Badge>;
  }
  
  return <Badge tone="info">{status ?? 'Unknown'}</Badge>;
};

const Listings: React.FC = () => {
  // State
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [limit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters & Search
  const [searchValue, setSearchValue] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  
  // Modals
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showHealthModal, setShowHealthModal] = useState(false);
  const [linkModalData, setLinkModalData] = useState<{shopifyId: string; ebayId: string}>({shopifyId: '', ebayId: ''});
  
  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  
  // Queries
  const { data: healthData } = useQuery({
    queryKey: ['listings-health'],
    queryFn: () => api.get<ListingHealth[]>('/listings/health'),
    staleTime: 60000,
  });
  
  const { data: staleData } = useQuery({
    queryKey: ['listings-stale'],
    queryFn: () => api.get<StaleListing[]>('/listings/stale'),
    staleTime: 60000,
  });
  
  // Mutations
  const syncProductMutation = useMutation({
    mutationFn: (productId: string) => api.put(`/sync/products/${productId}`),
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Product sync initiated' });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Sync failed', message: error.message });
    },
  });
  
  const endListingMutation = useMutation({
    mutationFn: (productId: string) => api.post(`/sync/products/${productId}/end`),
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Listing ended successfully' });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Failed to end listing', message: error.message });
    },
  });
  
  const linkProductsMutation = useMutation({
    mutationFn: (data: {shopifyProductId: string; ebayItemId: string}) => 
      api.post('/listings/link', data),
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Products linked successfully' });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      setShowLinkModal(false);
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Failed to link products', message: error.message });
    },
  });
  
  const bulkSyncMutation = useMutation({
    mutationFn: (productIds: string[]) => 
      Promise.all(productIds.map(id => api.put(`/sync/products/${id}`))),
    onSuccess: () => {
      addNotification({ type: 'success', title: `${selectedItems.length} products synced` });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      setSelectedItems([]);
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Bulk sync failed', message: error.message });
    },
  });
  
  const republishStaleMutation = useMutation({
    mutationFn: () => api.post('/listings/republish-stale'),
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Stale listings republished' });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Failed to republish stale listings', message: error.message });
    },
  });
  
  const applyPriceDropsMutation = useMutation({
    mutationFn: () => api.post('/listings/apply-price-drops'),
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Price drops applied' });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Failed to apply price drops', message: error.message });
    },
  });

  // Load listings with filters
  const loadListings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });
      
      if (searchValue) params.append('search', searchValue);
      if (selectedStatus.length > 0) params.append('status', selectedStatus.join(','));
      
      const response = await fetch(`/api/listings?${params}`);
      if (!response.ok) throw new Error('Failed to fetch listings');
      
      const data = (await response.json()) as ListingsResponse;
      
      // Enhance listings with health data (defensive — API may return object or array)
      const healthArr = Array.isArray(healthData) ? healthData : [];
      const staleArr = Array.isArray(staleData) ? staleData : [];
      const listingsArr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const enhancedListings = listingsArr.map((listing: any) => {
        const health = healthArr.find(h => h.listingId === listing.ebayListingId);
        const stale = staleArr.find(s => s.listingId === listing.ebayListingId);
        
        return {
          ...listing,
          healthScore: health?.score,
          status: stale ? 'stale' as const : listing.status,
        };
      });
      
      setListings(enhancedListings);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch listings');
    } finally {
      setLoading(false);
    }
  }, [limit, offset, searchValue, selectedStatus, healthData, staleData]);

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  // Filter functions
  const clearAllFilters = useCallback(() => {
    setSearchValue('');
    setSelectedStatus([]);
    setOffset(0);
  }, []);

  const filters = [
    {
      key: 'status',
      label: 'Status',
      filter: (
        <Filters
          queryValue={searchValue}
          queryPlaceholder="Search listings..."
          onQueryChange={setSearchValue}
          onQueryClear={() => setSearchValue('')}
          filters={[
            {
              key: 'status',
              label: 'Status',
              filter: (
                <div>
                  {/* Status filter implementation would go here */}
                </div>
              ),
            },
          ]}
          onClearAll={clearAllFilters}
        />
      ),
    },
  ];

  // Table row actions
  const promotePrimaryActions = useMemo(() => {
    if (selectedItems.length === 0) return [];
    
    return [
      {
        content: `Sync Selected (${selectedItems.length})`,
        onAction: () => bulkSyncMutation.mutate(selectedItems),
        loading: bulkSyncMutation.isPending,
      },
    ];
  }, [selectedItems, bulkSyncMutation]);

  // Pagination
  const pagination = useMemo(() => {
    const hasPrevious = offset > 0;
    const hasNext = offset + limit < total;

    return (
      <Pagination
        hasPrevious={hasPrevious}
        onPrevious={() => setOffset(Math.max(0, offset - limit))}
        hasNext={hasNext}
        onNext={() => setOffset(offset + limit)}
      />
    );
  }, [limit, offset, total]);

  // Table headings
  const headings = [
    { title: 'Product' },
    { title: 'eBay Listing' },
    { title: 'Status' },
    { title: 'Health' },
    { title: 'Price' },
    { title: 'Quantity' },
    { title: 'Performance' },
    { title: 'Last Synced' },
    { title: 'Actions' },
  ] as any;

  const rowMarkup = listings.map((listing, index) => (
    <IndexTable.Row
      id={String(listing.id)}
      key={listing.id}
      position={index}
      selected={selectedItems.includes(String(listing.id))}
    >
      <IndexTable.Cell>
        <div style={{ minWidth: '200px' }}>
          <BlockStack gap="100">
            <Text variant="bodyMd" fontWeight="semibold" as="span">
              {listing.shopifyTitle || listing.shopifyProductId}
            </Text>
            {listing.shopifySku && (
              <Text variant="bodySm" tone="subdued" as="span">
                SKU: {listing.shopifySku}
              </Text>
            )}
          </BlockStack>
        </div>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <div style={{ minWidth: '150px' }}>
          <BlockStack gap="100">
            <Text variant="bodyMd" as="span">
              {listing.ebayTitle || listing.ebayListingId}
            </Text>
            <Text variant="bodySm" tone="subdued" as="span">
              ID: {listing.ebayListingId}
            </Text>
          </BlockStack>
        </div>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <div className="flex items-center gap-2">
          <StatusIndicator
            type="sync"
            status={listing.status === 'synced' ? 'idle' : 
                   listing.status === 'pending' ? 'syncing' :
                   listing.status === 'error' ? 'error' : 'idle'}
            size="sm"
          />
          {getStatusBadge(listing.status, listing.healthScore)}
        </div>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        {listing.healthScore ? (
          <div className="flex items-center gap-2">
            <div 
              className={`w-3 h-3 rounded-full ${
                listing.healthScore >= 80 ? 'bg-green-500' :
                listing.healthScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'
              }`} 
            />
            <Text variant="bodySm" as="span">
              {listing.healthScore}/100
            </Text>
          </div>
        ) : (
          <Text variant="bodySm" tone="subdued" as="span">—</Text>
        )}
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {listing.price ? `$${listing.price.toFixed(2)}` : '—'}
        </Text>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {listing.quantity ?? '—'}
        </Text>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        {listing.views || listing.watchers ? (
          <BlockStack gap="050">
            {listing.views && (
              <Text variant="bodySm" tone="subdued" as="span">
                {listing.views} views
              </Text>
            )}
            {listing.watchers && (
              <Text variant="bodySm" tone="subdued" as="span">
                {listing.watchers} watchers
              </Text>
            )}
          </BlockStack>
        ) : (
          <Text variant="bodySm" tone="subdued" as="span">—</Text>
        )}
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <Text variant="bodySm" tone="subdued" as="span">
          {formatTimestamp(listing.lastSynced || listing.updatedAt)}
        </Text>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <ButtonGroup>
          <Button
            size="micro"
            icon={<RefreshCw className="w-3 h-3" />}
            onClick={() => syncProductMutation.mutate(listing.shopifyProductId)}
            loading={syncProductMutation.isPending}
            accessibilityLabel="Sync product"
          />
          <Button
            size="micro"
            icon={<ExternalLink className="w-3 h-3" />}
            onClick={() => window.open(`https://www.ebay.com/itm/${listing.ebayListingId}`, '_blank')}
            accessibilityLabel="View on eBay"
          />
          <Button
            size="micro"
            icon={<XCircle className="w-3 h-3" />}
            tone="critical"
            onClick={() => endListingMutation.mutate(listing.shopifyProductId)}
            loading={endListingMutation.isPending}
            accessibilityLabel="End listing"
          />
        </ButtonGroup>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page 
      title="Products & Listings"
      primaryAction={{
        content: 'Link Products',
        onAction: () => setShowLinkModal(true),
      }}
      secondaryActions={[
        {
          content: 'View Health Report',
          onAction: () => setShowHealthModal(true),
        },
        {
          content: 'Refresh',
          onAction: () => loadListings(),
        },
      ]}
    >
      {/* Summary Cards */}
      <Layout>
        <Layout.Section>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            <Card>
              <div className="text-center p-4">
                <div className="flex items-center justify-center mb-2">
                  <Package className="w-6 h-6 text-shopify-500" />
                </div>
                <Text variant="headingLg" as="h3">{total}</Text>
                <Text variant="bodyMd" tone="subdued" as="p">Total Listings</Text>
              </div>
            </Card>
            
            <Card>
              <div className="text-center p-4">
                <div className="flex items-center justify-center mb-2">
                  <CheckCircle className="w-6 h-6 text-green-500" />
                </div>
                <Text variant="headingLg" as="h3">
                  {listings.filter(l => l.status === 'synced' || l.status === 'active').length}
                </Text>
                <Text variant="bodyMd" tone="subdued" as="p">Active Listings</Text>
              </div>
            </Card>
            
            <Card>
              <div className="text-center p-4">
                <div className="flex items-center justify-center mb-2">
                  <AlertTriangle className="w-6 h-6 text-yellow-500" />
                </div>
                <Text variant="headingLg" as="h3">
                  {(Array.isArray(staleData) ? staleData.length : 0) || listings.filter(l => l.status === 'stale').length || 0}
                </Text>
                <Text variant="bodyMd" tone="subdued" as="p">Stale Listings</Text>
              </div>
            </Card>
            
            <Card>
              <div className="text-center p-4">
                <div className="flex items-center justify-center mb-2">
                  <XCircle className="w-6 h-6 text-red-500" />
                </div>
                <Text variant="headingLg" as="h3">
                  {listings.filter(l => l.status === 'error').length}
                </Text>
                <Text variant="bodyMd" tone="subdued" as="p">Errors</Text>
              </div>
            </Card>
          </div>
        </Layout.Section>

        {/* Bulk Actions */}
        <Layout.Section>
          <Card>
            <div className="p-4">
              <InlineStack gap="300" align="space-between">
                <Text variant="headingMd" as="h3">Bulk Actions</Text>
                <ButtonGroup>
                  <Button
                    icon={<RefreshCw className="w-4 h-4" />}
                    loading={republishStaleMutation.isPending}
                    onClick={() => republishStaleMutation.mutate()}
                  >
                    Republish Stale
                  </Button>
                  <Button
                    icon={<TrendingUp className="w-4 h-4" />}
                    loading={applyPriceDropsMutation.isPending}
                    onClick={() => applyPriceDropsMutation.mutate()}
                  >
                    Apply Price Drops
                  </Button>
                </ButtonGroup>
              </InlineStack>
            </div>
          </Card>
        </Layout.Section>

        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Unable to load listings">
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Main Table */}
        <Layout.Section>
          <Card>
            <div style={{ padding: '1rem' }}>
              {/* Search */}
              <div style={{ marginBottom: '1rem' }}>
                <TextField
                  label=""
                  placeholder="Search listings by title, SKU, or eBay ID..."
                  value={searchValue}
                  onChange={setSearchValue}
                  prefix={<Search className="w-4 h-4" />}
                  clearButton
                  onClearButtonClick={() => setSearchValue('')}
                  autoComplete="off"
                />
              </div>
              
              {/* Status Filter */}
              <div style={{ marginBottom: '1rem' }}>
                <InlineStack gap="200">
                  <Button
                    pressed={selectedStatus.length === 0}
                    onClick={() => setSelectedStatus([])}
                  >
                    All
                  </Button>
                  <Button
                    pressed={selectedStatus.includes('active')}
                    onClick={() => setSelectedStatus(['active', 'synced'])}
                  >
                    Active
                  </Button>
                  <Button
                    pressed={selectedStatus.includes('pending')}
                    onClick={() => setSelectedStatus(['pending'])}
                  >
                    Pending
                  </Button>
                  <Button
                    pressed={selectedStatus.includes('stale')}
                    onClick={() => setSelectedStatus(['stale'])}
                  >
                    Stale
                  </Button>
                  <Button
                    pressed={selectedStatus.includes('error')}
                    onClick={() => setSelectedStatus(['error'])}
                  >
                    Errors
                  </Button>
                </InlineStack>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-8">
                <Spinner accessibilityLabel="Loading listings" size="large" />
              </div>
            ) : (
              <IndexTable
                resourceName={{ singular: 'listing', plural: 'listings' }}
                itemCount={listings.length}
                selectedItemsCount={selectedItems.length}
                onSelectionChange={(selectionType, toggleType, selection) => {
                  if (selectionType === 'all') {
                    setSelectedItems(toggleType ? listings.map(l => String(l.id)) : []);
                  } else if (selectionType === 'page') {
                    setSelectedItems(toggleType ? listings.map(l => String(l.id)) : []);
                  } else if (selectionType === 'single' && typeof selection === 'string') {
                    setSelectedItems(prev => 
                      prev.includes(selection) 
                        ? prev.filter(id => id !== selection)
                        : [...prev, selection]
                    );
                  }
                }}
                headings={headings}
                promotedBulkActions={promotePrimaryActions}
                selectable
              >
                {rowMarkup}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>

        <Layout.Section>
          {pagination}
        </Layout.Section>
      </Layout>

      {/* Link Products Modal */}
      <Modal
        open={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        title="Link Shopify Product to eBay Listing"
        primaryAction={{
          content: 'Link Products',
          onAction: () => linkProductsMutation.mutate({
            shopifyProductId: linkModalData.shopifyId,
            ebayItemId: linkModalData.ebayId,
          }),
          loading: linkProductsMutation.isPending,
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setShowLinkModal(false),
        }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Shopify Product ID"
              value={linkModalData.shopifyId}
              onChange={(value) => setLinkModalData(prev => ({ ...prev, shopifyId: value }))}
              autoComplete="off"
            />
            <TextField
              label="eBay Item ID"
              value={linkModalData.ebayId}
              onChange={(value) => setLinkModalData(prev => ({ ...prev, ebayId: value }))}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Health Report Modal */}
      <Modal
        open={showHealthModal}
        onClose={() => setShowHealthModal(false)}
        title="Listing Health Report"
      >
        <Modal.Section>
          {Array.isArray(healthData) && healthData.length > 0 ? (
            <div className="space-y-4">
              {healthData.slice(0, 10).map((health) => (
                <Card key={health.listingId}>
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        Listing: {health.listingId}
                      </Text>
                      <div className="flex items-center gap-2">
                        <div 
                          className={`w-3 h-3 rounded-full ${
                            health.score >= 80 ? 'bg-green-500' :
                            health.score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                          }`} 
                        />
                        <Text variant="bodySm" as="span">
                          Score: {health.score}/100
                        </Text>
                      </div>
                    </div>
                    
                    {health.issues.length > 0 && (
                      <div className="mb-2">
                        <Text variant="bodySm" fontWeight="semibold" as="p">Issues:</Text>
                        <ul className="list-disc list-inside text-sm text-red-600">
                          {health.issues.map((issue, idx) => (
                            <li key={idx}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {health.recommendations.length > 0 && (
                      <div>
                        <Text variant="bodySm" fontWeight="semibold" as="p">Recommendations:</Text>
                        <ul className="list-disc list-inside text-sm text-blue-600">
                          {health.recommendations.map((rec, idx) => (
                            <li key={idx}>{rec}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Text variant="bodyLg" tone="subdued" as="p">
                No health data available
              </Text>
            </div>
          )}
        </Modal.Section>
      </Modal>

      {/* Toast */}
      {toastMessage && (
        <Toast
          content={toastMessage}
          onDismiss={() => setToastMessage(null)}
        />
      )}
    </Page>
  );
};

export default Listings;