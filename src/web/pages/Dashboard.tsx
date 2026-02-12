import React, { useMemo } from 'react';
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Badge,
  Card,
  Divider,
  InlineStack,
  Layout,
  Page,
  Spinner,
  Text,
} from '@shopify/polaris';
import {
  ChartLineIcon,
  CheckCircleIcon,
  CashDollarIcon,
  ProductIcon,
  OrderIcon,
} from '@shopify/polaris-icons';
import { useLogs, useStatus } from '../hooks/useApi';
import MetricCard from '../components/MetricCard';
import { useAppStore } from '../store';

const formatTimestamp = (value?: string | number | null) => {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const Dashboard: React.FC = () => {
  const { data: statusData, isLoading, error } = useStatus();
  const { data: logsData } = useLogs(10);
  const { notifications, connections } = useAppStore();

  const activityRows = useMemo(() => {
    if (!logsData?.data) return [];
    return logsData.data.slice(0, 5).map((log) => ({
      id: String(log.id ?? Math.random()),
      topic: log.topic ?? log.message ?? 'Sync event',
      source: log.source ?? 'System',
      status: log.status ?? 'info',
      timestamp: formatTimestamp(log.createdAt ?? log.created_at),
    }));
  }, [logsData]);

  if (error) {
    return (
      <Page title="Dashboard">
        <Banner tone="critical" title="Failed to load dashboard">
          <Text as="p">{(error as Error).message}</Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page title="Dashboard" subtitle="Monitor sync status and storefront connections">
      <BlockStack gap="400">
        {notifications.slice(0, 2).map((notice) => (
          <Banner
            key={notice.id}
            tone={notice.type === 'error' ? 'critical' : notice.type === 'warning' ? 'warning' : 'success'}
            title={notice.title}
          >
            {notice.message && <Text as="p">{notice.message}</Text>}
          </Banner>
        ))}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">
                      Sync status
                    </Text>
                    <Text tone="subdued" as="p">
                      {statusData?.status === 'running' ? 'System is healthy' : 'Waiting for sync'}
                    </Text>
                  </BlockStack>
                  {isLoading ? <Spinner size="small" /> : null}
                </InlineStack>
                <InlineStack gap="400" align="space-between" wrap>
                  <MetricCard
                    title="Products mapped"
                    value={statusData?.products?.mapped ?? 0}
                    icon={<ProductIcon />}
                    loading={isLoading}
                  />
                  <MetricCard
                    title="Orders imported"
                    value={statusData?.orders?.imported ?? 0}
                    icon={<OrderIcon />}
                    loading={isLoading}
                  />
                  <MetricCard
                    title="Inventory synced"
                    value={statusData?.inventory?.synced ?? 0}
                    icon={<CheckCircleIcon />}
                    loading={isLoading}
                  />
                  <MetricCard
                    title="Revenue"
                    value={`$${(statusData?.revenue?.total ?? statusData?.revenue?.today ?? 0).toLocaleString()}`}
                    icon={<CashDollarIcon />}
                    loading={isLoading}
                  />
                </InlineStack>
                <Divider />
                <InlineStack gap="400" wrap>
                  <Box>
                    <Text variant="bodySm" tone="subdued" as="p">
                      Last sync
                    </Text>
                    <Text variant="headingSm" as="p">
                      {statusData?.lastSyncs?.[0]
                        ? formatTimestamp((statusData.lastSyncs[0] as any).created_at ?? (statusData.lastSyncs[0] as any).createdAt)
                        : '—'}
                    </Text>
                  </Box>
                  <Box>
                    <Text variant="bodySm" tone="subdued" as="p">
                      Uptime
                    </Text>
                    <Text variant="headingSm" as="p">
                      {statusData?.uptime ? `${Math.floor(statusData.uptime / 3600)}h` : '—'}
                    </Text>
                  </Box>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">
                  Connections
                </Text>
                <InlineStack align="space-between">
                  <Text as="span">Shopify</Text>
                  <Badge tone={connections.shopify ? 'success' : 'critical'}>
                    {connections.shopify ? 'Connected' : 'Disconnected'}
                  </Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span">eBay</Text>
                  <Badge tone={connections.ebay ? 'success' : 'critical'}>
                    {connections.ebay ? 'Connected' : 'Disconnected'}
                  </Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h3">
                    Recent sync activity
                  </Text>
                  <Button variant="plain" icon={ChartLineIcon} disabled>
                    View logs
                  </Button>
                </InlineStack>
                {activityRows.length === 0 ? (
                  <Box padding="300">
                    <InlineStack align="center">
                      <Text tone="subdued" as="p">
                        No recent activity
                      </Text>
                    </InlineStack>
                  </Box>
                ) : (
                  <BlockStack gap="200">
                    {activityRows.map((row) => (
                      <InlineStack key={row.id} align="space-between">
                        <BlockStack gap="100">
                          <Text variant="bodyMd" as="p">
                            {row.topic}
                          </Text>
                          <Text variant="bodySm" tone="subdued" as="p">
                            {row.source}
                          </Text>
                        </BlockStack>
                        <BlockStack gap="100" inlineAlign="end">
                          <Badge tone={row.status === 'error' ? 'critical' : row.status === 'warning' ? 'warning' : 'info'}>
                            {row.status}
                          </Badge>
                          <Text variant="bodySm" tone="subdued" as="p">
                            {row.timestamp}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
};

export default Dashboard;
