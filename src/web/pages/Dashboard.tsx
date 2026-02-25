import React, { useMemo } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
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
  ProductIcon,
  OrderIcon,
  SettingsIcon,
  ViewIcon,
  ImageIcon,
  ClipboardChecklistIcon,
  StatusActiveIcon,
  AlertCircleIcon,
} from '@shopify/polaris-icons';
import { useNavigate } from 'react-router-dom';
import { useLogs, useStatus } from '../hooks/useApi';
import { useAppStore } from '../store';

/* ────────────────── Helpers ────────────────── */

const formatTimestamp = (value?: string | number | null) => {
  if (!value) return '—';
  const ms =
    typeof value === 'number'
      ? value > 1_000_000_000_000
        ? value
        : value * 1000
      : Date.parse(value);
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return d.toLocaleDateString();
};

const formatUptime = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
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
        {tone && <Badge tone={tone}>{tone}</Badge>}
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

/* ────────────────── Quick Action Card ────────────────── */

interface ActionCardProps {
  title: string;
  description: string;
  icon: any;
  onClick: () => void;
  badge?: string;
  badgeTone?: 'success' | 'info' | 'warning' | 'critical';
  cta?: string;
}

const ActionCard: React.FC<ActionCardProps> = ({ title, description, icon, onClick, badge, badgeTone, cta }) => (
  <Card>
    <BlockStack gap="200">
      <InlineStack gap="200" blockAlign="center" align="space-between">
        <InlineStack gap="200" blockAlign="center">
          <Box background="bg-fill-secondary" borderRadius="200" padding="200">
            <Icon source={icon} />
          </Box>
          <Text variant="headingSm" as="h3">
            {title}
          </Text>
        </InlineStack>
        {badge && <Badge tone={badgeTone}>{badge}</Badge>}
      </InlineStack>
      <Text variant="bodySm" tone="subdued" as="p">
        {description}
      </Text>
      <Button onClick={onClick} variant="secondary">
        {cta ?? 'Open'}
      </Button>
    </BlockStack>
  </Card>
);

/* ────────────────── Dashboard ────────────────── */

const Dashboard: React.FC = () => {
  const { data: statusData, isLoading, error } = useStatus();
  const { data: logsData } = useLogs(10);
  const navigate = useNavigate();
  const { connections } = useAppStore();

  const activityRows = useMemo(() => {
    if (!logsData?.data) return [];
    return logsData.data.slice(0, 6).map((log) => ({
      id: String(log.id ?? Math.random()),
      topic: log.topic ?? log.message ?? 'Sync event',
      source: log.source ?? 'System',
      status: log.status ?? 'info',
      timestamp: formatTimestamp(log.createdAt ?? log.created_at),
    }));
  }, [logsData]);

  if (error) {
    return (
      <Page title="ProductPipeline">
        <Banner tone="critical" title="Unable to connect">
          <Text as="p">{(error as Error).message}</Text>
        </Banner>
      </Page>
    );
  }

  const productsMapped = statusData?.products?.mapped ?? 0;
  const ordersImported = statusData?.orders?.imported ?? 0;
  const inventorySynced = statusData?.inventory?.synced ?? 0;
  const revenueTotal = statusData?.revenue?.total ?? statusData?.revenue?.today ?? 0;

  return (
    <Page title="ProductPipeline" subtitle="Your listing pipeline at a glance" fullWidth>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300" blockAlign="center">
                    <Box
                      background={statusData?.status === 'running' ? 'bg-fill-success-secondary' : 'bg-fill-warning-secondary'}
                      borderRadius="full"
                      padding="200"
                    >
                      <Icon
                        source={statusData?.status === 'running' ? StatusActiveIcon : AlertCircleIcon}
                        tone={statusData?.status === 'running' ? 'success' : 'warning'}
                      />
                    </Box>
                    <BlockStack gap="100">
                      <Text variant="headingMd" as="h2">
                        {statusData?.status === 'running' ? 'All systems operational' : 'Connecting…'}
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        Uptime {formatUptime(statusData?.uptime)}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <InlineStack gap="300">
                    <InlineStack gap="100" blockAlign="center">
                      <Text variant="bodySm" as="span">
                        Shopify
                      </Text>
                      <Badge tone={connections.shopify ? 'success' : 'critical'}>
                        {connections.shopify ? 'Connected' : 'Disconnected'}
                      </Badge>
                    </InlineStack>
                    <InlineStack gap="100" blockAlign="center">
                      <Text variant="bodySm" as="span">
                        eBay
                      </Text>
                      <Badge tone={connections.ebay ? 'success' : 'critical'}>
                        {connections.ebay ? 'Connected' : 'Disconnected'}
                      </Badge>
                    </InlineStack>
                  </InlineStack>
                </InlineStack>
                <Divider />
                <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="300">
                  {isLoading ? (
                    <>
                      <Card>
                        <BlockStack gap="200">
                          <SkeletonDisplayText size="large" />
                          <SkeletonBodyText lines={1} />
                        </BlockStack>
                      </Card>
                      <Card>
                        <BlockStack gap="200">
                          <SkeletonDisplayText size="large" />
                          <SkeletonBodyText lines={1} />
                        </BlockStack>
                      </Card>
                      <Card>
                        <BlockStack gap="200">
                          <SkeletonDisplayText size="large" />
                          <SkeletonBodyText lines={1} />
                        </BlockStack>
                      </Card>
                      <Card>
                        <BlockStack gap="200">
                          <SkeletonDisplayText size="large" />
                          <SkeletonBodyText lines={1} />
                        </BlockStack>
                      </Card>
                    </>
                  ) : (
                    <>
                      <StatCard
                        label="Products Mapped"
                        value={productsMapped}
                        icon={ProductIcon}
                        tone={productsMapped > 0 ? 'success' : undefined}
                      />
                      <StatCard
                        label="Orders Imported"
                        value={ordersImported}
                        icon={OrderIcon}
                        tone={ordersImported > 0 ? 'success' : undefined}
                      />
                      <StatCard
                        label="Inventory Synced"
                        value={inventorySynced}
                        icon={ClipboardChecklistIcon}
                      />
                      <StatCard
                        label="Revenue"
                        value={`$${revenueTotal.toLocaleString()}`}
                        icon={ViewIcon}
                      />
                    </>
                  )}
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">
                Quick actions
              </Text>
              <InlineGrid columns={{ xs: 1, sm: 2, md: 2 }} gap="300">
                <ActionCard
                  title="Browse Products"
                  description="View your Shopify catalog, run the AI pipeline, and manage listings"
                  icon={ProductIcon}
                  onClick={() => navigate('/listings')}
                  badge={`${productsMapped} mapped`}
                  badgeTone="info"
                  cta="Open catalog"
                />
                <ActionCard
                  title="eBay Listings"
                  description="Manage your active and draft eBay listings"
                  icon={ViewIcon}
                  onClick={() => navigate('/ebay/listings')}
                  cta="View listings"
                />
                <ActionCard
                  title="Pipeline"
                  description="Monitor AI descriptions, image processing, and listing creation"
                  icon={ImageIcon}
                  onClick={() => navigate('/pipeline')}
                  cta="Open pipeline"
                />
                <ActionCard
                  title="Settings"
                  description="Configure connections, prompts, and sync preferences"
                  icon={SettingsIcon}
                  onClick={() => navigate('/settings')}
                  cta="Open settings"
                />
              </InlineGrid>
            </BlockStack>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    Recent activity
                  </Text>
                  <Button variant="plain" onClick={() => navigate('/logs')}>
                    View all
                  </Button>
                </InlineStack>
                <Divider />
                {activityRows.length === 0 ? (
                  <BlockStack gap="200" inlineAlign="center">
                    <Text tone="subdued" as="p">
                      No sync activity yet
                    </Text>
                    <Button onClick={() => navigate('/listings')}>List your first product</Button>
                  </BlockStack>
                ) : (
                  <BlockStack gap="300">
                    {activityRows.map((row) => (
                      <InlineStack key={row.id} align="space-between" blockAlign="start">
                        <BlockStack gap="050">
                          <Text variant="bodyMd" as="p" fontWeight="medium">
                            {row.topic}
                          </Text>
                          <Text variant="bodySm" tone="subdued" as="p">
                            {row.source}
                          </Text>
                        </BlockStack>
                        <InlineStack gap="200" blockAlign="center">
                          <Badge
                            tone={
                              row.status === 'error'
                                ? 'critical'
                                : row.status === 'warning'
                                  ? 'warning'
                                  : row.status === 'success'
                                    ? 'success'
                                    : 'info'
                            }
                          >
                            {row.status}
                          </Badge>
                          <Text variant="bodySm" tone="subdued" as="p">
                            {row.timestamp}
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

export default Dashboard;
