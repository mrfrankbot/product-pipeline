import React, { useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  Icon,
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
import { SearchIcon, OrderIcon } from '@shopify/polaris-icons';
import { useOrders } from '../hooks/useApi';

const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Synced', value: 'synced' },
  { label: 'Fulfilled', value: 'fulfilled' },
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
    <Page title="Orders" subtitle="Imported orders from eBay" fullWidth>
      <BlockStack gap="500">
        
        {/* ── Orders Summary Card ── */}
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="300" blockAlign="center">
              <Box
                background="bg-fill-secondary"
                borderRadius="200"
                padding="200"
              >
                <Icon source={OrderIcon} />
              </Box>
              <BlockStack gap="050">
                <Text variant="headingSm" as="h2">Order Management</Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  {total} total orders
                </Text>
              </BlockStack>
            </InlineStack>
          </InlineStack>
        </Card>

        {/* ── Filters & Search ── */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="300" align="space-between">
              <TextField
                label=""
                value={searchValue}
                onChange={(value) => {
                  setSearchValue(value);
                  setPageOffset(0);
                }}
                placeholder="Search by eBay order ID or Shopify order ID"
                prefix={<Icon source={SearchIcon} />}
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setSearchValue('')}
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

            <Divider />

            {error && (
              <Banner tone="critical" title="Unable to load orders">
                <Text as="p">{(error as Error).message}</Text>
              </Banner>
            )}

            {isLoading ? (
              <Box padding="400">
                <InlineStack align="center">
                  <Spinner accessibilityLabel="Loading orders" size="large" />
                </InlineStack>
              </Box>
            ) : orders.length === 0 ? (
              <Box padding="400">
                <BlockStack gap="300" inlineAlign="center">
                  <Icon source={OrderIcon} tone="subdued" />
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingSm" as="h3">No orders found</Text>
                    <Text tone="subdued" as="p">
                      {searchValue || statusFilter
                        ? 'Try adjusting your search or filters'
                        : 'Orders will appear here once imported from eBay'}
                    </Text>
                  </BlockStack>
                  {searchValue || statusFilter ? (
                    <Button
                      onClick={() => {
                        setSearchValue('');
                        setStatusFilter('');
                        setPageOffset(0);
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : null}
                </BlockStack>
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
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        {order.ebay_order_id ?? order.ebayOrderId ?? '—'}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text variant="bodyMd" as="span">
                        {order.shopify_order_id ?? order.shopifyOrderId ?? '—'}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge 
                        tone={
                          order.status === 'fulfilled'
                            ? 'success'
                            : order.status === 'synced'
                              ? 'info'
                              : order.status === 'failed'
                                ? 'critical'
                                : 'info'
                        }
                      >
                        {order.status ?? 'unknown'}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text variant="bodyMd" as="span">{formatCurrency(order.total)}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text variant="bodySm" tone="subdued" as="span">
                        {formatTimestamp(order.ebay_created_at ?? order.created_at ?? order.createdAt)}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        {/* ── Pagination ── */}
        {!isLoading && orders.length > 0 && (
          <InlineStack align="center">
            <Pagination
              hasPrevious={hasPrevious}
              onPrevious={() => setPageOffset(Math.max(0, pageOffset - 25))}
              hasNext={hasNext}
              onNext={() => setPageOffset(pageOffset + 25)}
            />
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
};

export default Orders;
