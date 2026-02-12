import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  ButtonGroup,
  Card,
  IndexTable,
  Layout,
  Page,
  Pagination,
  Spinner,
  Text,
  TextField,
  Modal,
  Toast,
  DatePicker,
  Select,
  Box,
  InlineStack,
  BlockStack,
  Divider,
  DataTable,
  EmptyState,
} from '@shopify/polaris';
import {
  RefreshCw,
  Search,
  Download,
  Upload,
  ExternalLink,
  Eye,
  Package,
  ShoppingCart,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Filter,
  Calendar,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store';
import StatusIndicator from '../components/StatusIndicator';
import MetricCard from '../components/MetricCard';

interface Order {
  id: number;
  ebayOrderId: string;
  shopifyOrderId?: string;
  shopifyOrderName?: string | null;
  customerEmail?: string;
  customerName?: string;
  total?: number;
  currency?: string;
  status: 'imported' | 'pending' | 'failed' | 'synced' | 'error';
  fulfillmentStatus?: 'unfulfilled' | 'fulfilled' | 'partial';
  orderDate?: string;
  syncedAt?: number | string | null;
  items?: OrderItem[];
  shippingAddress?: Address;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

interface OrderItem {
  title: string;
  quantity: number;
  price: number;
  sku?: string;
}

interface Address {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  country: string;
  zip: string;
}

interface OrdersResponse {
  data: Order[];
  total: number;
  limit: number;
  offset: number;
  stats?: {
    imported: number;
    pending: number;
    failed: number;
    totalValue: number;
    avgOrderValue: number;
  };
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

const formatCurrency = (amount?: number, currency = 'USD') => {
  if (!amount) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
};

const getStatusBadge = (status: string) => {
  const normalized = status?.toLowerCase();
  
  switch (normalized) {
    case 'imported':
    case 'synced':
      return <Badge tone="success">Imported</Badge>;
    case 'pending':
      return <Badge tone="info">Pending</Badge>;
    case 'failed':
    case 'error':
      return <Badge tone="critical">Failed</Badge>;
    default:
      return <Badge tone="info">{status ?? 'Unknown'}</Badge>;
  }
};

const getFulfillmentBadge = (status?: string) => {
  if (!status) return null;
  
  const normalized = status.toLowerCase();
  switch (normalized) {
    case 'fulfilled':
      return <Badge tone="success">Fulfilled</Badge>;
    case 'partial':
      return <Badge tone="warning">Partially Fulfilled</Badge>;
    case 'unfulfilled':
      return <Badge tone="attention">Unfulfilled</Badge>;
    default:
      return <Badge tone="info">{status}</Badge>;
  }
};

const Orders: React.FC = () => {
  // State
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<OrdersResponse['stats']>();
  const [total, setTotal] = useState(0);
  const [limit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters & Search
  const [searchValue, setSearchValue] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string[]>([]);
  const [selectedFulfillment, setSelectedFulfillment] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<{start?: Date; end?: Date}>({});
  
  // Modals
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  
  // Mutations
  const syncOrdersMutation = useMutation({
    mutationFn: () => api.post('/sync/trigger', { type: 'orders' }),
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Order sync initiated' });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Sync failed', message: error.message });
    },
  });
  
  const cleanupDuplicatesMutation = useMutation({
    mutationFn: () => api.post('/orders/cleanup'),
    onSuccess: (result: any) => {
      addNotification({ 
        type: 'success', 
        title: 'Cleanup completed', 
        message: `Removed ${result.removed || 0} duplicate orders` 
      });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error) => {
      addNotification({ type: 'error', title: 'Cleanup failed', message: error.message });
    },
  });

  // Load orders with filters
  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });
      
      if (searchValue) params.append('search', searchValue);
      if (selectedStatus.length > 0) params.append('status', selectedStatus.join(','));
      if (selectedFulfillment.length > 0) params.append('fulfillment', selectedFulfillment.join(','));
      if (dateRange.start) params.append('startDate', dateRange.start.toISOString());
      if (dateRange.end) params.append('endDate', dateRange.end.toISOString());
      
      const response = await fetch(`/api/orders?${params}`);
      if (!response.ok) throw new Error('Failed to fetch orders');
      
      const data = (await response.json()) as OrdersResponse;
      // API returns snake_case from SQLite — normalize to camelCase
      const rawOrders = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const normalized = rawOrders.map((o: any) => ({
        ...o,
        ebayOrderId: o.ebayOrderId || o.ebay_order_id,
        shopifyOrderId: o.shopifyOrderId || o.shopify_order_id,
        shopifyOrderName: o.shopifyOrderName || o.shopify_order_name,
        syncedAt: o.syncedAt || o.synced_at,
        createdAt: o.createdAt || o.created_at,
        updatedAt: o.updatedAt || o.updated_at,
      }));
      setOrders(normalized);
      setTotal(data.total ?? 0);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch orders');
    } finally {
      setLoading(false);
    }
  }, [limit, offset, searchValue, selectedStatus, selectedFulfillment, dateRange]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  // Filter functions
  const clearAllFilters = useCallback(() => {
    setSearchValue('');
    setSelectedStatus([]);
    setSelectedFulfillment([]);
    setDateRange({});
    setOffset(0);
  }, []);

  // View order details
  const viewOrderDetails = (order: Order) => {
    setSelectedOrder(order);
    setShowOrderModal(true);
  };

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
    { title: 'Order' },
    { title: 'Customer' },
    { title: 'Status' },
    { title: 'Fulfillment' },
    { title: 'Total' },
    { title: 'Order Date' },
    { title: 'Sync Status' },
    { title: 'Actions' },
  ] as any;

  const rowMarkup = orders.map((order, index) => (
    <IndexTable.Row
      id={String(order.id)}
      key={order.id}
      position={index}
    >
      <IndexTable.Cell>
        <div style={{ minWidth: '180px' }}>
          <BlockStack gap="100">
            <Text variant="bodyMd" fontWeight="semibold" as="span">
              {order.shopifyOrderName || (order as any).shopify_order_name || `#${order.ebayOrderId || (order as any).ebay_order_id || 'unknown'}`}
            </Text>
            <Text variant="bodySm" tone="subdued" as="span">
              eBay: {order.ebayOrderId}
            </Text>
            {order.shopifyOrderId && (
              <Text variant="bodySm" tone="subdued" as="span">
                Shopify: {order.shopifyOrderId}
              </Text>
            )}
          </BlockStack>
        </div>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <div style={{ minWidth: '150px' }}>
          <BlockStack gap="100">
            {order.customerName && (
              <Text variant="bodyMd" as="span">
                {order.customerName}
              </Text>
            )}
            {order.customerEmail && (
              <Text variant="bodySm" tone="subdued" as="span">
                {order.customerEmail}
              </Text>
            )}
          </BlockStack>
        </div>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <div className="flex items-center gap-2">
          <StatusIndicator
            type="sync"
            status={order.status === 'imported' || order.status === 'synced' ? 'idle' : 
                   order.status === 'pending' ? 'syncing' :
                   order.status === 'failed' || order.status === 'error' ? 'error' : 'idle'}
            size="sm"
          />
          {getStatusBadge(order.status)}
        </div>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        {getFulfillmentBadge(order.fulfillmentStatus)}
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {formatCurrency(order.total, order.currency)}
        </Text>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <Text variant="bodySm" tone="subdued" as="span">
          {order.orderDate ? formatTimestamp(order.orderDate) : '—'}
        </Text>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <Text variant="bodySm" tone="subdued" as="span">
          {formatTimestamp(order.syncedAt)}
        </Text>
      </IndexTable.Cell>
      
      <IndexTable.Cell>
        <ButtonGroup>
          <Button
            size="micro"
            icon={<Eye className="w-3 h-3" />}
            onClick={() => viewOrderDetails(order)}
            accessibilityLabel="View details"
          />
          {order.ebayOrderId && (
            <Button
              size="micro"
              icon={<ExternalLink className="w-3 h-3" />}
              onClick={() => window.open(`https://www.ebay.com/sh/ord/details?orderid=${order.ebayOrderId}`, '_blank')}
              accessibilityLabel="View on eBay"
            />
          )}
          {order.shopifyOrderId && (
            <Button
              size="micro"
              icon={<ExternalLink className="w-3 h-3" />}
              onClick={() => window.open(`https://admin.shopify.com/store/your-store/orders/${order.shopifyOrderId}`, '_blank')}
              accessibilityLabel="View in Shopify"
            />
          )}
        </ButtonGroup>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page 
      title="Orders"
      primaryAction={{
        content: 'Sync Orders',
        onAction: () => syncOrdersMutation.mutate(),
        loading: syncOrdersMutation.isPending,
      }}
      secondaryActions={[
        {
          content: 'Cleanup Duplicates',
          onAction: () => cleanupDuplicatesMutation.mutate(),
        },
        {
          content: 'Export Orders',
          onAction: () => {
            // TODO: Implement export functionality
            setToastMessage('Export feature coming soon');
          },
        },
      ]}
    >
      {/* Summary Cards */}
      <Layout>
        <Layout.Section>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            <MetricCard
              title="Total Orders"
              value={total}
              icon={<ShoppingCart className="w-5 h-5" />}
              color="default"
              loading={loading}
            />
            
            <MetricCard
              title="Imported Orders"
              value={stats?.imported || orders.filter(o => o.status === 'imported' || o.status === 'synced').length}
              icon={<CheckCircle className="w-5 h-5" />}
              color="success"
              loading={loading}
            />
            
            <MetricCard
              title="Pending Orders"
              value={stats?.pending || orders.filter(o => o.status === 'pending').length}
              icon={<Clock className="w-5 h-5" />}
              color="warning"
              loading={loading}
            />
            
            <MetricCard
              title="Failed Orders"
              value={stats?.failed || orders.filter(o => o.status === 'failed' || o.status === 'error').length}
              icon={<XCircle className="w-5 h-5" />}
              color="error"
              loading={loading}
            />
            
            <MetricCard
              title="Total Value"
              value={formatCurrency(stats?.totalValue || orders.reduce((sum, o) => sum + (o.total || 0), 0))}
              icon={<TrendingUp className="w-5 h-5" />}
              color="success"
              loading={loading}
            />
            
            <MetricCard
              title="Avg Order Value"
              value={formatCurrency(stats?.avgOrderValue || 
                (orders.length > 0 ? orders.reduce((sum, o) => sum + (o.total || 0), 0) / orders.length : 0))}
              icon={<Package className="w-5 h-5" />}
              color="default"
              loading={loading}
            />
          </div>
        </Layout.Section>

        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Unable to load orders">
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Filters & Search */}
        <Layout.Section>
          <Card>
            <div style={{ padding: '1rem' }}>
              <BlockStack gap="400">
                {/* Search */}
                <TextField
                  label=""
                  placeholder="Search orders by eBay ID, customer email, or order name..."
                  value={searchValue}
                  onChange={setSearchValue}
                  prefix={<Search className="w-4 h-4" />}
                  clearButton
                  onClearButtonClick={() => setSearchValue('')}
                  autoComplete="off"
                />
                
                {/* Status Filters */}
                <InlineStack gap="200" align="space-between">
                  <div>
                    <Text variant="bodySm" fontWeight="semibold" as="p">Status:</Text>
                    <InlineStack gap="100">
                      <Button
                        pressed={selectedStatus.length === 0}
                        onClick={() => setSelectedStatus([])}
                        size="micro"
                      >
                        All
                      </Button>
                      <Button
                        pressed={selectedStatus.includes('imported')}
                        onClick={() => setSelectedStatus(['imported', 'synced'])}
                        size="micro"
                      >
                        Imported
                      </Button>
                      <Button
                        pressed={selectedStatus.includes('pending')}
                        onClick={() => setSelectedStatus(['pending'])}
                        size="micro"
                      >
                        Pending
                      </Button>
                      <Button
                        pressed={selectedStatus.includes('failed')}
                        onClick={() => setSelectedStatus(['failed', 'error'])}
                        size="micro"
                      >
                        Failed
                      </Button>
                    </InlineStack>
                  </div>
                  
                  <div>
                    <Text variant="bodySm" fontWeight="semibold" as="p">Fulfillment:</Text>
                    <InlineStack gap="100">
                      <Button
                        pressed={selectedFulfillment.includes('unfulfilled')}
                        onClick={() => setSelectedFulfillment(['unfulfilled'])}
                        size="micro"
                      >
                        Unfulfilled
                      </Button>
                      <Button
                        pressed={selectedFulfillment.includes('partial')}
                        onClick={() => setSelectedFulfillment(['partial'])}
                        size="micro"
                      >
                        Partial
                      </Button>
                      <Button
                        pressed={selectedFulfillment.includes('fulfilled')}
                        onClick={() => setSelectedFulfillment(['fulfilled'])}
                        size="micro"
                      >
                        Fulfilled
                      </Button>
                    </InlineStack>
                  </div>
                  
                  <Button
                    onClick={clearAllFilters}
                    variant="plain"
                    icon={<Filter className="w-4 h-4" />}
                  >
                    Clear Filters
                  </Button>
                </InlineStack>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Main Table */}
        <Layout.Section>
          <Card>
            {loading ? (
              <div className="text-center py-8">
                <Spinner accessibilityLabel="Loading orders" size="large" />
              </div>
            ) : orders.length === 0 ? (
              <EmptyState
                heading="No orders found"
                image="/empty-orders.svg"
              >
                <p>
                  {searchValue || selectedStatus.length > 0 || selectedFulfillment.length > 0 
                    ? "Try adjusting your search or filters"
                    : "Orders will appear here once they're synced from eBay"}
                </p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: 'order', plural: 'orders' }}
                itemCount={orders.length}
                headings={headings}
                selectable={false}
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

      {/* Order Details Modal */}
      <Modal
        open={showOrderModal}
        onClose={() => setShowOrderModal(false)}
        title={`Order Details: ${selectedOrder?.shopifyOrderName || selectedOrder?.ebayOrderId}`}
      >
        <Modal.Section>
          {selectedOrder && (
            <BlockStack gap="400">
              {/* Order Info */}
              <Card>
                <div style={{ padding: '1rem' }}>
                  <Text variant="headingMd" as="h3">Order Information</Text>
                  <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                    <div>
                      <Text variant="bodySm" fontWeight="semibold" as="p">eBay Order ID</Text>
                      <Text variant="bodyMd" as="p">{selectedOrder.ebayOrderId}</Text>
                    </div>
                    {selectedOrder.shopifyOrderId && (
                      <div>
                        <Text variant="bodySm" fontWeight="semibold" as="p">Shopify Order ID</Text>
                        <Text variant="bodyMd" as="p">{selectedOrder.shopifyOrderId}</Text>
                      </div>
                    )}
                    <div>
                      <Text variant="bodySm" fontWeight="semibold" as="p">Status</Text>
                      {getStatusBadge(selectedOrder.status)}
                    </div>
                    {selectedOrder.fulfillmentStatus && (
                      <div>
                        <Text variant="bodySm" fontWeight="semibold" as="p">Fulfillment</Text>
                        {getFulfillmentBadge(selectedOrder.fulfillmentStatus)}
                      </div>
                    )}
                    <div>
                      <Text variant="bodySm" fontWeight="semibold" as="p">Total</Text>
                      <Text variant="bodyMd" as="p">{formatCurrency(selectedOrder.total, selectedOrder.currency)}</Text>
                    </div>
                    <div>
                      <Text variant="bodySm" fontWeight="semibold" as="p">Order Date</Text>
                      <Text variant="bodyMd" as="p">{formatTimestamp(selectedOrder.orderDate)}</Text>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Customer Info */}
              {(selectedOrder.customerName || selectedOrder.customerEmail) && (
                <Card>
                  <div style={{ padding: '1rem' }}>
                    <Text variant="headingMd" as="h3">Customer Information</Text>
                    <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                      {selectedOrder.customerName && (
                        <div>
                          <Text variant="bodySm" fontWeight="semibold" as="p">Name</Text>
                          <Text variant="bodyMd" as="p">{selectedOrder.customerName}</Text>
                        </div>
                      )}
                      {selectedOrder.customerEmail && (
                        <div>
                          <Text variant="bodySm" fontWeight="semibold" as="p">Email</Text>
                          <Text variant="bodyMd" as="p">{selectedOrder.customerEmail}</Text>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              )}

              {/* Shipping Address */}
              {selectedOrder.shippingAddress && (
                <Card>
                  <div style={{ padding: '1rem' }}>
                    <Text variant="headingMd" as="h3">Shipping Address</Text>
                    <div style={{ marginTop: '1rem' }}>
                      <Text variant="bodyMd" as="p">{selectedOrder.shippingAddress.name}</Text>
                      <Text variant="bodyMd" as="p">{selectedOrder.shippingAddress.address1}</Text>
                      {selectedOrder.shippingAddress.address2 && (
                        <Text variant="bodyMd" as="p">{selectedOrder.shippingAddress.address2}</Text>
                      )}
                      <Text variant="bodyMd" as="p">
                        {selectedOrder.shippingAddress.city}, {selectedOrder.shippingAddress.province} {selectedOrder.shippingAddress.zip}
                      </Text>
                      <Text variant="bodyMd" as="p">{selectedOrder.shippingAddress.country}</Text>
                    </div>
                  </div>
                </Card>
              )}

              {/* Order Items */}
              {selectedOrder.items && selectedOrder.items.length > 0 && (
                <Card>
                  <div style={{ padding: '1rem' }}>
                    <Text variant="headingMd" as="h3">Order Items</Text>
                    <div style={{ marginTop: '1rem' }}>
                      <DataTable
                        columnContentTypes={['text', 'text', 'numeric', 'numeric']}
                        headings={['Item', 'SKU', 'Quantity', 'Price']}
                        rows={selectedOrder.items.map(item => [
                          item.title,
                          item.sku || '—',
                          item.quantity,
                          formatCurrency(item.price),
                        ])}
                      />
                    </div>
                  </div>
                </Card>
              )}

              {/* Error Details */}
              {selectedOrder.error && (
                <Banner tone="critical" title="Sync Error">
                  <p>{selectedOrder.error}</p>
                </Banner>
              )}
            </BlockStack>
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

export default Orders;