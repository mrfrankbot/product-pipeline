import React, { useMemo } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  DataTable,
  Divider,
  Icon,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
} from '@shopify/polaris';
import {
  ChartLineIcon,
  ChartVerticalIcon,
  OrderIcon,
  StatusActiveIcon,
  AlertCircleIcon,
  ViewIcon,
} from '@shopify/polaris-icons';
import { useListingHealth, useLogs } from '../hooks/useApi';

const formatTimestamp = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

/* ────────────────── Stat Card ────────────────── */

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.FC<any>;
  tone?: 'success' | 'critical' | 'warning' | 'info';
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, tone }) => (
  <Card>
    <BlockStack gap="200">
      <Box
        background={
          tone === 'success'
            ? 'bg-fill-success-secondary'
            : tone === 'critical'
              ? 'bg-fill-critical-secondary'
              : tone === 'warning'
                ? 'bg-fill-warning-secondary'
                : 'bg-fill-secondary'
        }
        borderRadius="200"
        padding="200"
        width="fit-content"
      >
        <Icon source={icon} tone={tone ?? 'base'} />
      </Box>
      <Text variant="headingXl" as="p">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
      <Text variant="bodySm" tone="subdued" as="p">
        {label}
      </Text>
    </BlockStack>
  </Card>
);

/* ────────────────── Analytics ────────────────── */

const Analytics: React.FC = () => {
  const { data: logsData, isLoading: logsLoading, error: logsError } = useLogs(100);
  const { data: healthData, isLoading: healthLoading, error: healthError } = useListingHealth();

  const errorRows = useMemo(() => {
    if (!logsData?.data) return [];
    return logsData.data
      .filter((log) => log.status === 'error')
      .slice(0, 10)
      .map((log) => [
        log.topic ?? log.message ?? 'Error',
        log.source ?? 'System',
        formatTimestamp(log.createdAt ?? log.created_at),
      ]);
  }, [logsData]);

  const ageBucketRows = useMemo(() => {
    return Object.entries(healthData?.ageBuckets ?? {}).map(([bucket, count]) => [bucket, count]);
  }, [healthData]);

  const isLoading = logsLoading || healthLoading;
  const hasError = logsError || healthError;

  if (hasError) {
    return (
      <Page title="Analytics" subtitle="Sync history and listing health" fullWidth>
        <Banner tone="critical" title="Analytics unavailable">
          <Text as="p">{(logsError as Error)?.message ?? (healthError as Error)?.message}</Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page title="Analytics" subtitle="Sync history and listing health" fullWidth>
      <BlockStack gap="500">

        {/* ── Listing Health Stats ── */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300" blockAlign="center">
                    <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                      <Icon source={ChartLineIcon} />
                    </Box>
                    <BlockStack gap="050">
                      <Text variant="headingMd" as="h2">Listing health</Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        Snapshot of your eBay listings
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </InlineStack>

                <Divider />

                <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="300">
                  {isLoading ? (
                    <>
                      {[...Array(4)].map((_, i) => (
                        <Card key={i}>
                          <BlockStack gap="200">
                            <SkeletonDisplayText size="large" />
                            <SkeletonBodyText lines={1} />
                          </BlockStack>
                        </Card>
                      ))}
                    </>
                  ) : (
                    <>
                      <StatCard
                        label="Active listings"
                        value={healthData?.totalActive ?? 0}
                        icon={StatusActiveIcon}
                        tone={healthData?.totalActive ? 'success' : undefined}
                      />
                      <StatCard
                        label="Ended listings"
                        value={healthData?.totalEnded ?? 0}
                        icon={AlertCircleIcon}
                      />
                      <StatCard
                        label="Avg days listed"
                        value={healthData?.averageDaysListed ?? 0}
                        icon={ChartVerticalIcon}
                      />
                      <StatCard
                        label="Revenue"
                        value={`$${(healthData?.revenue ?? 0).toLocaleString()}`}
                        icon={ViewIcon}
                        tone={healthData?.revenue ? 'success' : undefined}
                      />
                    </>
                  )}
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* ── Age Buckets + Errors ── */}
        <Layout>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                    <Icon source={ChartVerticalIcon} />
                  </Box>
                  <Text variant="headingMd" as="h2">Listings by age</Text>
                </InlineStack>
                <Divider />
                {isLoading ? (
                  <SkeletonBodyText lines={5} />
                ) : ageBucketRows.length === 0 ? (
                  <Box padding="400">
                    <Text tone="subdued" as="p">No listing age data available.</Text>
                  </Box>
                ) : (
                  <DataTable
                    columnContentTypes={['text', 'numeric']}
                    headings={['Age bucket', 'Listings']}
                    rows={ageBucketRows}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Box background="bg-fill-critical-secondary" borderRadius="200" padding="200">
                    <Icon source={AlertCircleIcon} tone="critical" />
                  </Box>
                  <Text variant="headingMd" as="h2">Recent errors</Text>
                </InlineStack>
                <Divider />
                {isLoading ? (
                  <SkeletonBodyText lines={5} />
                ) : errorRows.length === 0 ? (
                  <Box padding="400">
                    <BlockStack gap="200" inlineAlign="center">
                      <Icon source={StatusActiveIcon} tone="success" />
                      <Text tone="subdued" as="p">No recent errors — all good!</Text>
                    </BlockStack>
                  </Box>
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
        </Layout>

        {/* ── Sync History ── */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                    <Icon source={OrderIcon} />
                  </Box>
                  <Text variant="headingMd" as="h2">Latest sync history</Text>
                </InlineStack>
                <Divider />
                {isLoading ? (
                  <SkeletonBodyText lines={6} />
                ) : (logsData?.data ?? []).length === 0 ? (
                  <Box padding="400">
                    <Text tone="subdued" as="p">No sync activity yet.</Text>
                  </Box>
                ) : (
                  <BlockStack gap="300">
                    {(logsData?.data ?? []).slice(0, 10).map((log) => (
                      <InlineStack key={String(log.id ?? Math.random())} align="space-between" blockAlign="start">
                        <BlockStack gap="050">
                          <Text variant="bodyMd" fontWeight="medium" as="p">
                            {log.topic ?? log.message ?? 'Sync event'}
                          </Text>
                          <Text variant="bodySm" tone="subdued" as="p">
                            {log.source ?? 'System'}
                          </Text>
                        </BlockStack>
                        <InlineStack gap="200" blockAlign="center">
                          <Badge
                            tone={
                              log.status === 'error'
                                ? 'critical'
                                : log.status === 'warning'
                                  ? 'warning'
                                  : log.status === 'success'
                                    ? 'success'
                                    : 'info'
                            }
                          >
                            {log.status ?? 'info'}
                          </Badge>
                          <Text variant="bodySm" tone="subdued" as="p">
                            {formatTimestamp(log.createdAt ?? log.created_at)}
                          </Text>
                        </InlineStack>
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

export default Analytics;
