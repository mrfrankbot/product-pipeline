import React, { useMemo } from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Card,
  DataTable,
  Divider,
  InlineStack,
  Layout,
  Page,
  Spinner,
  Text,
} from '@shopify/polaris';
import { ChartLineIcon } from '@shopify/polaris-icons';
import { useListingHealth, useLogs } from '../hooks/useApi';

const formatTimestamp = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

const Analytics: React.FC = () => {
  const { data: logsData, isLoading: logsLoading, error: logsError } = useLogs(100);
  const { data: healthData, isLoading: healthLoading, error: healthError } = useListingHealth();

  const errorRows = useMemo(() => {
    if (!logsData?.data) return [];
    return logsData.data
      .filter((log) => log.status === 'error')
      .slice(0, 6)
      .map((log) => [
        log.topic ?? log.message ?? 'Error',
        log.source ?? 'System',
        formatTimestamp(log.createdAt ?? log.created_at),
      ]);
  }, [logsData]);

  if (logsLoading || healthLoading) {
    return (
      <Page title="Analytics" subtitle="Sync history and listing health">
        <Card>
          <Box padding="600">
            <InlineStack align="center">
              <Spinner size="large" accessibilityLabel="Loading analytics" />
            </InlineStack>
          </Box>
        </Card>
      </Page>
    );
  }

  if (logsError || healthError) {
    return (
      <Page title="Analytics" subtitle="Sync history and listing health">
        <Card>
          <BlockStack gap="200">
            <Text variant="headingMd" as="h2">Analytics unavailable</Text>
            <Text as="p">{(logsError as Error)?.message ?? (healthError as Error)?.message}</Text>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Analytics" subtitle="Sync history and listing health">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  Listing health
                </Text>
                <ChartLineIcon />
              </InlineStack>
              <InlineStack gap="300" wrap>
                <Card>
                  <Box padding="300">
                    <Text variant="bodySm" tone="subdued" as="p">Active listings</Text>
                    <Text variant="headingMd" as="p">{healthData?.totalActive ?? 0}</Text>
                  </Box>
                </Card>
                <Card>
                  <Box padding="300">
                    <Text variant="bodySm" tone="subdued" as="p">Ended listings</Text>
                    <Text variant="headingMd" as="p">{healthData?.totalEnded ?? 0}</Text>
                  </Box>
                </Card>
                <Card>
                  <Box padding="300">
                    <Text variant="bodySm" tone="subdued" as="p">Avg days listed</Text>
                    <Text variant="headingMd" as="p">{healthData?.averageDaysListed ?? 0}</Text>
                  </Box>
                </Card>
                <Card>
                  <Box padding="300">
                    <Text variant="bodySm" tone="subdued" as="p">Revenue (orders)</Text>
                    <Text variant="headingMd" as="p">${(healthData?.revenue ?? 0).toLocaleString()}</Text>
                  </Box>
                </Card>
              </InlineStack>
              <Divider />
              <DataTable
                columnContentTypes={['text', 'numeric']}
                headings={['Age bucket', 'Listings']}
                rows={Object.entries(healthData?.ageBuckets ?? {}).map(([bucket, count]) => [bucket, count])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Recent errors</Text>
              {errorRows.length === 0 ? (
                <Text tone="subdued" as="p">No recent errors logged.</Text>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text']}
                  headings={['Message', 'Source', 'Timestamp']}
                  rows={errorRows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Latest sync history</Text>
              <BlockStack gap="200">
                {(logsData?.data ?? []).slice(0, 8).map((log) => (
                  <InlineStack key={String(log.id ?? Math.random())} align="space-between">
                    <BlockStack gap="100">
                      <Text as="p">{log.topic ?? log.message ?? 'Sync event'}</Text>
                      <Text tone="subdued" as="p">{log.source ?? 'System'}</Text>
                    </BlockStack>
                    <InlineStack gap="200" align="center">
                      <Badge tone={log.status === 'error' ? 'critical' : log.status === 'warning' ? 'warning' : 'info'}>
                        {log.status ?? 'info'}
                      </Badge>
                      <Text tone="subdued" as="p">{formatTimestamp(log.createdAt ?? log.created_at)}</Text>
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export default Analytics;
