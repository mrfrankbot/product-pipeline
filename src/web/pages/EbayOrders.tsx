import React, { useMemo, useState, useCallback } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  Divider,
  IndexTable,
  InlineStack,
  Layout,
  Modal,
  Page,
  Pagination,
  Select,
  Spinner,
  Text,
  TextField,
  Tooltip,
} from '@shopify/polaris';
import { SearchIcon } from '@shopify/polaris-icons';
import {
  useEbayOrders,
  useEbayOrderStats,
  useImportEbayOrders,
  type EbayOrderItem,
} from '../hooks/useApi';

const PAGE_SIZE = 25;

const FULFILLMENT_OPTIONS = [
  { label: 'All fulfillment', value: '' },
  { label: 'Fulfilled', value: 'FULFILLED' },
  { label: 'Not Started', value: 'NOT_STARTED' },
  { label: 'In Progress', value: 'IN_PROGRESS' },
];

const PAYMENT_OPTIONS = [
  { label: 'All payment', value: '' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Failed', value: 'FAILED' },
];

const DAYS_OPTIONS = [
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 60 days', value: '60' },
  { label: 'Last 90 days', value: '90' },
];

const formatCurrency = (amount?: number | null, currency = 'USD') => {
  if (amount === undefined || amount === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatTimestamp = (unix?: number | null) => {
  if (!unix) return 'Never';
  const d = new Date(unix * 1000);
  return isNaN(d.getTime()) ? 'Never' : d.toLocaleString();
};

const fulfillmentTone = (status?: string | null): 'success' | 'attention' | 'warning' | 'info' | undefined => {
  switch (status) {
    case 'FULFILLED': return 'success';
    case 'IN_PROGRESS': return 'attention';
    case 'NOT_STARTED': return 'warning';
    default: return 'info';
  }
};

const paymentTone = (status?: string | null): 'success' | 'critical' | 'attention' | 'info' | undefined => {
  switch (status) {
    case 'PAID': return 'success';
    case 'FAILED': return 'critical';
    case 'PENDING': return 'attention';
    default: return 'info';
  }
};

/** Inline detail panel for an order */
const OrderDetail: React.FC<{ order: EbayOrderItem }> = ({ order }) => {
  const lineItems = useMemo(() => {
    try { return JSON.parse(order.line_items_json || '[]'); } catch { return []; }
  }, [order.line_items_json]);

  const shipping = useMemo(() => {
    try { return order.shipping_address_json ? JSON.parse(order.shipping_address_json) : null; } catch { return null; }
  }, [order.shipping_address_json]);

  return (
    <Box padding="400" background="bg-surface-secondary">
      <BlockStack gap="400">
        <InlineStack gap="800" align="start">
          {/* Line items */}
          <BlockStack gap="200">
            <Text variant="headingSm" as="h3">Line Items</Text>
            {lineItems.length === 0 && <Text as="p" tone="subdued">No line items</Text>}
            {lineItems.map((item: any, i: number) => (
              <InlineStack key={i} gap="200" blockAlign="center">
                <Text as="span" variant="bodySm" fontWeight="semibold">{item.quantity ?? 1}×</Text>
                <Text as="span" variant="bodySm">{item.title || item.legacyItemId || 'Unknown item'}</Text>
                {item.lineItemCost && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    {formatCurrency(parseFloat(item.lineItemCost.value), item.lineItemCost.currency)}
                  </Text>
                )}
              </InlineStack>
            ))}
          </BlockStack>

          {/* Shipping */}
          {shipping && (
            <BlockStack gap="200">
              <Text variant="headingSm" as="h3">Shipping Address</Text>
              <Text as="p" variant="bodySm">{shipping.fullName}</Text>
              {shipping.contactAddress && (
                <>
                  <Text as="p" variant="bodySm">{shipping.contactAddress.addressLine1}</Text>
                  {shipping.contactAddress.addressLine2 && <Text as="p" variant="bodySm">{shipping.contactAddress.addressLine2}</Text>}
                  <Text as="p" variant="bodySm">
                    {shipping.contactAddress.city}, {shipping.contactAddress.stateOrProvince} {shipping.contactAddress.postalCode}
                  </Text>
                </>
              )}
            </BlockStack>
          )}
        </InlineStack>

        <InlineStack gap="200">
          <Tooltip content="Coming soon">
            <Button disabled>Sync to Shopify</Button>
          </Tooltip>
        </InlineStack>
      </BlockStack>
    </Box>
  );
};

const EbayOrders: React.FC = () => {
  const [search, setSearch] = useState('');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [pageOffset, setPageOffset] = useState(0);
  const [importDays, setImportDays] = useState('30');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useEbayOrders({
    limit: PAGE_SIZE,
    offset: pageOffset,
    search: search || undefined,
    fulfillmentStatus: fulfillmentFilter || undefined,
    paymentStatus: paymentFilter || undefined,
  });

  const { data: stats } = useEbayOrderStats();
  const importMutation = useImportEbayOrders();

  const orders = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasPrev = pageOffset > 0;
  const hasNext = pageOffset + PAGE_SIZE < total;

  const handleImport = useCallback(() => {
    importMutation.mutate({ days: parseInt(importDays) });
  }, [importDays, importMutation]);

  const resourceName = { singular: 'order', plural: 'orders' };

  const rowMarkup = orders.map((order, index) => (
    <React.Fragment key={order.id}>
      <IndexTable.Row
        id={String(order.id)}
        position={index}
        onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
        selected={false}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="semibold" as="span">
            {order.legacy_order_id || order.ebay_order_id}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{order.buyer_username || '—'}</IndexTable.Cell>
        <IndexTable.Cell>{order.item_count ?? 0}</IndexTable.Cell>
        <IndexTable.Cell>{formatCurrency(order.total_amount, order.currency)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={fulfillmentTone(order.fulfillment_status)}>
            {order.fulfillment_status || 'UNKNOWN'}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={paymentTone(order.payment_status)}>
            {order.payment_status || 'UNKNOWN'}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{formatDate(order.ebay_created_at)}</IndexTable.Cell>
        <IndexTable.Cell>
          {order.synced_to_shopify ? (
            <Badge tone="success">Synced</Badge>
          ) : (
            <Badge tone="info">Not synced</Badge>
          )}
        </IndexTable.Cell>
      </IndexTable.Row>
      {expandedId === order.id && (
        <IndexTable.Row id={`${order.id}-detail`} position={index} selected={false}>
          <IndexTable.Cell colSpan={8}>
            <OrderDetail order={order} />
          </IndexTable.Cell>
        </IndexTable.Row>
      )}
    </React.Fragment>
  ));

  return (
    <Page title="eBay Orders" fullWidth>
      <BlockStack gap="500">
        {/* ─── CRITICAL SAFETY BANNER ─────────────────────────────────────── */}
        <Banner tone="critical" title="⚠️ Lightspeed POS Impact — Read Before Syncing">
          <BlockStack gap="200">
            <Text as="p">
              <strong>Every Shopify order created here flows into Lightspeed POS automatically.</strong>{' '}
              Duplicate orders caused hours of manual cleanup in February 2026.
            </Text>
            <Text as="p">
              The <strong>Import from eBay</strong> button is safe — it only stores orders to the local database.
              Syncing to Shopify requires explicit confirmation and is rate-limited to 5 orders/hour.
            </Text>
            <Text as="p" tone="critical">
              If you suspect duplicates already exist in Shopify, <strong>stop immediately</strong> and
              contact the developer before proceeding. Do not bulk-sync without verifying.
            </Text>
          </BlockStack>
        </Banner>

        <Layout>
          <Layout.Section variant="oneThird">
            {/* Import controls */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm" as="h2">Import from eBay</Text>
                <Select
                  label="Time range"
                  options={DAYS_OPTIONS}
                  value={importDays}
                  onChange={setImportDays}
                />
                <Button
                  variant="primary"
                  onClick={handleImport}
                  loading={importMutation.isPending}
                >
                  Import Orders from eBay
                </Button>
                {stats?.lastImportedAt && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Last import: {formatTimestamp(stats.lastImportedAt)}
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            {/* Stats */}
            <Card>
              <InlineStack gap="800" align="start">
                <BlockStack gap="100">
                  <Text variant="headingLg" as="p">{stats?.total ?? 0}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Total Orders</Text>
                </BlockStack>
                {stats?.byFulfillmentStatus && Object.entries(stats.byFulfillmentStatus).map(([status, count]) => (
                  <BlockStack gap="100" key={status}>
                    <Text variant="headingLg" as="p">{count}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{status}</Text>
                  </BlockStack>
                ))}
                <BlockStack gap="100">
                  <Text variant="headingLg" as="p">{stats?.synced ?? 0}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Synced</Text>
                </BlockStack>
              </InlineStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Filters */}
        <Card>
          <InlineStack gap="300" align="start" blockAlign="end">
            <div style={{ flexGrow: 1, maxWidth: 300 }}>
              <TextField
                label="Search"
                labelHidden
                placeholder="Search order ID or buyer…"
                value={search}
                onChange={(v) => { setSearch(v); setPageOffset(0); }}
                prefix={<span>🔍</span>}
                autoComplete="off"
              />
            </div>
            <Select
              label="Fulfillment"
              labelHidden
              options={FULFILLMENT_OPTIONS}
              value={fulfillmentFilter}
              onChange={(v) => { setFulfillmentFilter(v); setPageOffset(0); }}
            />
            <Select
              label="Payment"
              labelHidden
              options={PAYMENT_OPTIONS}
              value={paymentFilter}
              onChange={(v) => { setPaymentFilter(v); setPageOffset(0); }}
            />
          </InlineStack>
        </Card>

        {/* Orders table */}
        <Card padding="0">
          {isLoading ? (
            <Box padding="800">
              <InlineStack align="center"><Spinner /></InlineStack>
            </Box>
          ) : (
            <IndexTable
              resourceName={resourceName}
              itemCount={orders.length}
              headings={[
                { title: 'Order ID' },
                { title: 'Buyer' },
                { title: 'Items' },
                { title: 'Total' },
                { title: 'Fulfillment' },
                { title: 'Payment' },
                { title: 'Date' },
                { title: 'Synced' },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          )}
        </Card>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <InlineStack align="center">
            <Pagination
              hasPrevious={hasPrev}
              hasNext={hasNext}
              onPrevious={() => setPageOffset(Math.max(0, pageOffset - PAGE_SIZE))}
              onNext={() => setPageOffset(pageOffset + PAGE_SIZE)}
            />
            <Text as="p" variant="bodySm" tone="subdued">
              {pageOffset + 1}–{Math.min(pageOffset + PAGE_SIZE, total)} of {total}
            </Text>
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
};

export default EbayOrders;
