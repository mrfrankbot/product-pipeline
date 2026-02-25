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
  ChartVerticalFilledIcon,
  AlertCircleIcon,
  ClockIcon,
  StatusActiveIcon,
} from '@shopify/polaris-icons';
import { useListingHealth, useLogs } from '../hooks/useApi';

/* ────────────────── Helpers ────────────────── */

const formatTimestamp = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return d.toLocaleDateString();
};

/* ────────────────── Stat Card ────────────────── */

interface StatCardProps {
  label: string;
  value: string | number;
  icon: any;
  tone?: 'success' | 'critical' | 'warning' | 'info';
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, tone }) => (
  <Card>
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center">
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
        >
          <Icon source={icon} tone={tone ?? 'base'} />
        </Box>
      </InlineStack>
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
      .slice(0, 6)
      .map((log) => [
        log.topic ?? log.message ?? 'Error',
        log.source ?? 'System',
        formatTimestamp(log.createdAt ?? log.created_at),
      ]);
  }, [logsData]);

  const isLoading = logsLoading || healthLoading;

  if (logsError || healthError) {
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
                <InlineStack gap="300" blockAlign="center">
                  <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                    <Icon source={ChartVerticalFilledIcon} />
                  </Box>
                  <BlockStack gap="050">
                    <Text variant="headingMd" as="h2">Listing Health</Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      Overview of your active listings and performance
                    </Text>
                  </BlockStack>
                </InlineStack>
                <Divider />
                <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="300">
                  {isLoading ? (
                    <>
                      {[1, 2, 3, 4].map((i) => (
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
                        label="Active Listings"
                        value={healthData?.totalActive ?? 0}
                        icon={StatusActiveIcon}
                        tone={(healthData?.totalActive ?? 0) > 0 ? 'success' : undefined}
                      />
                      <StatCard
                        label="Ended Listings"
                        value={healthData?.totalEnded ?? 0}
                        icon={ClockIcon}
                      />
                      <StatCard
                        label="Avg Days Listed"
                        value={healthData?.averageDaysListed ?? 0}
                        icon={ClockIcon}
                      />
                      <StatCard
                        label="Revenue"
                        value={`$${(healthData?.revenue ?? 0).toLocaleString()}`}
                        icon={ChartVerticalFilledIcon}
                        tone={(healthData?.revenue ?? 0) > 0 ? 'success' : undefined}
                      />
                    </>
                  )}
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* ── Age Distribution ── */}
        {!isLoading && Object.keys(healthData?.ageBuckets ?? {}).length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Age Distribution</Text>
              <Divider />
              <DataTable
                columnContentTypes={['text', 'numeric']}
                headings={['Age Bucket', 'Listings']}
                rows={Object.entries(healthData?.ageBuckets ?? {}).map(([bucket, count]) => [bucket, count])}
              />
            </BlockStack>
          </Card>
        )}

        {/* ── Recent Errors ── */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="300" blockAlign="center">
              <Box
                background={errorRows.length > 0 ? 'bg-fill-critical-secondary' : 'bg-fill-success-secondary'}
                borderRadius="200"
                padding="200"
              >
                <Icon
                  source={AlertCircleIcon}
                  tone={errorRows.length > 0 ? 'critical' : 'success'}
                />
              </Box>
              <BlockStack gap="050">
                <Text variant="headingMd" as="h2">Recent Errors</Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  {errorRows.length === 0 ? 'No recent errors — all clear!' : `${errorRows.length} error${errorRows.length !== 1 ? 's' : ''} found`}
                </Text>
              </BlockStack>
            </InlineStack>
            {errorRows.length > 0 && (
              <>
                <Divider />
                <DataTable
                  columnContentTypes={['text', 'text', 'text']}
                  headings={['Message', 'Source', 'Timestamp']}
                  rows={errorRows}
                />
              </>
            )}
          </BlockStack>
        </Card>

        {/* ── Sync History ── */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Latest Sync History</Text>
            <Divider />
            {isLoading ? (
              <SkeletonBodyText lines={6} />
            ) : (logsData?.data ?? []).length === 0 ? (
              <BlockStack gap="200" inlineAlign="center">
                <Text tone="subdued" as="p">No sync activity yet</Text>
              </BlockStack>
            ) : (
              <BlockStack gap="300">
                {(logsData?.data ?? []).slice(0, 8).map((log) => (
                  <InlineStack key={String(log.id ?? Math.random())} align="space-between" blockAlign="start">
                    <BlockStack gap="050">
                      <Text variant="bodyMd" as="p" fontWeight="medium">
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
      </BlockStack>
    </Page>
  );
};

export default Analytics;
