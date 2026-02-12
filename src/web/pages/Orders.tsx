import React, { useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Pagination,
  Select,
  Spinner,
  Text,
  TextField,
} from '@shopify/polaris';
import { useOrders } from '../hooks/useApi';

const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Imported', value: 'imported' },
  { label: 'Pending', value: 'pending' },
  { label: 'Failed', value: 'failed' },
];

const formatCurrency = (amount?: number) => {
  if (amount === undefined || amount === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

const Orders: React.FC = () => {
  const [searchValue, setSearchValue] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pageOffset, setPageOffset] = useState(0);

  const { data, isLoading, error } = useOrders({
    limit: 25,
    offset: pageOffset,
    search: searchValue || undefined,
    status: statusFilter || undefined,
  });

  const orders = useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? 0;
  const hasPrevious = pageOffset > 0;
  const hasNext = pageOffset + 25 < total;

  return (
    <Page title="Orders" subtitle="Imported orders from eBay">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="300" align="space-between">
                <TextField
                  label="Search orders"
                  labelHidden
                  value={searchValue}
                  onChange={(value) => {
                    setSearchValue(value);
                    setPageOffset(0);
                  }}
                  placeholder="Search by eBay order ID or Shopify order ID"
                  autoComplete="off"
                />
                <Box minWidth="200px">
                  <Select
                    label="Status"
                    labelHidden
                    options={STATUS_OPTIONS}
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value);
                      setPageOffset(0);
                    }}
                  />
                </Box>
              </InlineStack>

              {error && (
                <Banner tone="critical" title="Unable to load orders">
                  <Text as="p">{(error as Error).message}</Text>
                </Banner>
              )}

              {isLoading ? (
                <Box padding="600">
                  <InlineStack align="center">
                    <Spinner accessibilityLabel="Loading orders" size="large" />
                  </InlineStack>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{ singular: 'order', plural: 'orders' }}
                  itemCount={orders.length}
                  selectable={false}
                  headings={[
                    { title: 'eBay order' },
                    { title: 'Shopify order' },
                    { title: 'Status' },
                    { title: 'Total' },
                    { title: 'Date' },
                  ]}
                >
                  {orders.map((order, index) => (
                    <IndexTable.Row
                      id={String(order.id ?? index)}
                      key={order.id ?? index}
                      position={index}
                    >
                      <IndexTable.Cell>
                        <Text fontWeight="semibold" as="span">
                          {order.ebay_order_id ?? order.ebayOrderId ?? '—'}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span">{order.shopify_order_id ?? order.shopifyOrderId ?? '—'}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={order.status === 'failed' ? 'critical' : order.status === 'pending' ? 'info' : 'success'}>
                          {order.status ?? 'unknown'}
                        </Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span">{formatCurrency(order.total)}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span">{formatTimestamp(order.created_at ?? order.createdAt)}</Text>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Box paddingBlockStart="300" paddingBlockEnd="300">
            <InlineStack align="center">
              <Pagination
                hasPrevious={hasPrevious}
                onPrevious={() => setPageOffset(Math.max(0, pageOffset - 25))}
                hasNext={hasNext}
                onNext={() => setPageOffset(pageOffset + 25)}
              />
            </InlineStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export default Orders;
