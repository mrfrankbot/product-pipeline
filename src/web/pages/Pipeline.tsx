import React, { useCallback, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  IndexTable,
  InlineGrid,
  InlineStack,
  Page,
  SkeletonBodyText,
  SkeletonPage,
  Text,
  TextField,
} from '@shopify/polaris';
import {
  ProductIcon,
  MagicIcon,
  ImageIcon,
  StoreIcon,
  StatusActiveIcon,
  AlertCircleIcon,
  ClockIcon,
  CheckCircleIcon,
  PlayIcon,
} from '@shopify/polaris-icons';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../hooks/useApi';
import PipelineProgress from '../components/PipelineProgress';

/* ────────────────── Types ────────────────── */

interface PipelineStep {
  name: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
}

interface PipelineJob {
  id: string;
  shopifyProductId: string;
  shopifyTitle?: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed' | string;
  currentStep?: string | null;
  steps?: PipelineStep[];
  startedAt?: number | string | null;
  completedAt?: number | string | null;
  createdAt?: number | string | null;
  updatedAt?: number | string | null;
  error?: string | null;
}

interface PipelineJobsResponse {
  jobs: PipelineJob[];
  count: number;
}

/* ────────────────── Helpers ────────────────── */

const STEP_LABELS: Record<string, string> = {
  fetch_product: 'Shopify Import',
  generate_description: 'AI Description',
  process_images: 'Image Processing',
  create_ebay_listing: 'eBay Listing',
};

const STAGE_CONFIG = [
  { key: 'import', label: 'Shopify Import', description: 'Products ingested from catalog', icon: ProductIcon, tone: 'info' as const },
  { key: 'ai', label: 'AI Description', description: 'Optimized listing copy generated', icon: MagicIcon, tone: 'warning' as const },
  { key: 'images', label: 'Image Processing', description: 'PhotoRoom templates applied', icon: ImageIcon, tone: 'success' as const },
  { key: 'listing', label: 'eBay Listing', description: 'Published to marketplace', icon: StoreIcon, tone: 'info' as const },
];

function resolveStepLabel(job: PipelineJob): string {
  if (job.currentStep) return job.currentStep;
  const running = job.steps?.find((s) => s.status === 'running');
  if (running?.name && STEP_LABELS[running.name]) return STEP_LABELS[running.name];
  const pending = job.steps?.find((s) => s.status === 'pending');
  if (pending?.name && STEP_LABELS[pending.name]) return STEP_LABELS[pending.name];
  return 'Shopify Import';
}

function toMilliseconds(value?: number | string | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatTimestamp(value?: number | string | null): string {
  const ms = toMilliseconds(value);
  if (!ms) return '—';
  const d = new Date(ms);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

function formatDuration(start?: number | string | null, end?: number | string | null): string {
  const startMs = toMilliseconds(start);
  if (!startMs) return '—';
  const endMs = toMilliseconds(end) ?? Date.now();
  const diffMs = Math.max(0, endMs - startMs);
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (totalMinutes > 0) return `${totalMinutes}m`;
  return `${Math.max(1, Math.floor(diffMs / 1000))}s`;
}

function statusBadge(status: string) {
  switch (status) {
    case 'completed': return <Badge tone="success">Completed</Badge>;
    case 'processing': return <Badge tone="attention">Processing</Badge>;
    case 'queued': return <Badge tone="info">Queued</Badge>;
    case 'failed': return <Badge tone="critical">Failed</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

/* ────────────────── Stage Card ────────────────── */

const StageCard: React.FC<{ icon: any; label: string; description: string; count: number; tone: 'info' | 'warning' | 'success' }> = ({ icon, label, description, count, tone }) => (
  <Card>
    <BlockStack gap="300" inlineAlign="center">
      <Box
        background={
          tone === 'success' ? 'bg-fill-success-secondary'
            : tone === 'warning' ? 'bg-fill-warning-secondary'
              : 'bg-fill-secondary'
        }
        borderRadius="200"
        padding="300"
      >
        <Icon source={icon} tone={tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'base'} />
      </Box>
      <Text variant="headingSm" as="h3" alignment="center">{label}</Text>
      <Text variant="bodySm" tone="subdued" as="p" alignment="center">{description}</Text>
      {count > 0 && <Badge tone="attention">{`${count} active`}</Badge>}
    </BlockStack>
  </Card>
);

/* ────────────────── Stat Card ────────────────── */

const StatCard: React.FC<{ label: string; value: number; icon: any; tone: 'success' | 'critical' | 'info' | 'warning' }> = ({ label, value, icon, tone }) => (
  <Card>
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center">
        <Box
          background={
            tone === 'success' ? 'bg-fill-success-secondary'
              : tone === 'critical' ? 'bg-fill-critical-secondary'
                : tone === 'warning' ? 'bg-fill-warning-secondary'
                  : 'bg-fill-secondary'
          }
          borderRadius="200"
          padding="200"
        >
          <Icon source={icon} tone={tone} />
        </Box>
      </InlineStack>
      <Text variant="headingXl" as="p">{value}</Text>
      <Text variant="bodySm" tone="subdued" as="p">{label}</Text>
    </BlockStack>
  </Card>
);

/* ────────────────── Pipeline Page ────────────────── */

const Pipeline: React.FC = () => {
  const [productId, setProductId] = useState('');
  const [triggerStatus, setTriggerStatus] = useState<{
    loading: boolean;
    result: null | { success: boolean; message: string; jobId?: string };
  }>({ loading: false, result: null });
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);

  const handleRunPipeline = useCallback(async () => {
    const id = productId.trim();
    if (!id) return;
    setTriggerStatus({ loading: true, result: null });
    try {
      const res = await apiClient.post<{ jobId?: string; message?: string; error?: string }>(
        `/auto-list/${encodeURIComponent(id)}`,
      );
      const newJobId = res.jobId;
      setTriggerStatus({ loading: false, result: { success: true, message: res.message || 'Pipeline job started', jobId: newJobId } });
      if (newJobId) setActiveJobIds((prev) => (prev.includes(newJobId) ? prev : [newJobId, ...prev]));
    } catch (err: any) {
      setTriggerStatus({ loading: false, result: { success: false, message: err?.message || 'Failed to start pipeline job' } });
    }
  }, [productId]);

  const { data, isLoading } = useQuery({
    queryKey: ['pipeline-jobs'],
    queryFn: () => apiClient.get<PipelineJobsResponse>('/pipeline/jobs'),
    refetchInterval: 10000,
    retry: 1,
  });

  const jobs: PipelineJob[] = data?.jobs ?? [];

  React.useEffect(() => {
    const activeFromData = jobs.filter((j) => j.status === 'processing' || j.status === 'queued').map((j) => j.id);
    if (activeFromData.length > 0) {
      setActiveJobIds((prev) => Array.from(new Set([...prev, ...activeFromData])));
    }
  }, [jobs]);

  const missingTitleIds = React.useMemo(() => {
    return Array.from(new Set(jobs.filter((j) => !j.shopifyTitle && j.shopifyProductId).map((j) => j.shopifyProductId)));
  }, [jobs]);

  const { data: titleLookup } = useQuery({
    queryKey: ['pipeline-job-titles', missingTitleIds],
    queryFn: async () => {
      if (missingTitleIds.length === 0) return {} as Record<string, string>;
      const entries = await Promise.all(
        missingTitleIds.map(async (id) => {
          try {
            const res = await apiClient.get<{ ok: boolean; product?: { title?: string } }>(`/test/product-info/${encodeURIComponent(id)}`);
            return [id, res.product?.title ?? ''] as const;
          } catch { return [id, ''] as const; }
        }),
      );
      return entries.reduce((acc, [id, title]) => { if (title) acc[id] = title; return acc; }, {} as Record<string, string>);
    },
    enabled: missingTitleIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Stage counts
  const countAtStep = (step: string) =>
    jobs.filter((j) => resolveStepLabel(j) === step && (j.status === 'processing' || j.status === 'queued')).length;

  const stageCounts: Record<string, number> = {
    import: countAtStep('Shopify Import'),
    ai: countAtStep('AI Description'),
    images: countAtStep('Image Processing'),
    listing: countAtStep('eBay Listing'),
  };

  const completed = jobs.filter((j) => j.status === 'completed').length;
  const processing = jobs.filter((j) => j.status === 'processing').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;

  if (isLoading) {
    return (
      <SkeletonPage title="Pipeline Overview" fullWidth>
        <BlockStack gap="400">
          <Card><SkeletonBodyText lines={3} /></Card>
          <Card><SkeletonBodyText lines={4} /></Card>
        </BlockStack>
      </SkeletonPage>
    );
  }

  return (
    <Page title="Pipeline Overview" subtitle="Real-time product automation flow" fullWidth>
      <BlockStack gap="500">
        {/* Process Product */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                <Icon source={PlayIcon} />
              </Box>
              <Text as="h2" variant="headingMd">Process Product</Text>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              Enter a Shopify product ID to run it through the auto-listing pipeline.
            </Text>
            <InlineStack gap="300" blockAlign="end">
              <Box minWidth="320px">
                <TextField
                  label="Shopify Product ID"
                  labelHidden
                  value={productId}
                  onChange={setProductId}
                  placeholder="e.g. 8012345678901"
                  autoComplete="off"
                  connectedRight={
                    <Button variant="primary" onClick={handleRunPipeline} loading={triggerStatus.loading} disabled={!productId.trim()}>
                      Run Pipeline
                    </Button>
                  }
                />
              </Box>
            </InlineStack>
            {triggerStatus.result && (
              <Banner
                tone={triggerStatus.result.success ? 'success' : 'critical'}
                title={triggerStatus.result.message}
                onDismiss={() => setTriggerStatus((prev) => ({ ...prev, result: null }))}
              >
                {triggerStatus.result.jobId && (
                  <Text as="p" variant="bodySm" tone="subdued">Job ID: {triggerStatus.result.jobId}</Text>
                )}
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* Active pipeline progress */}
        {activeJobIds.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Box background="bg-fill-warning-secondary" borderRadius="200" padding="200">
                    <Icon source={StatusActiveIcon} tone="warning" />
                  </Box>
                  <Text as="h2" variant="headingMd">Live Pipeline Progress</Text>
                </InlineStack>
                <Button
                  size="slim"
                  onClick={async () => {
                    await fetch('/api/pipeline/jobs/clear-stuck', { method: 'POST' });
                    setActiveJobIds([]);
                  }}
                >
                  Clear All
                </Button>
              </InlineStack>
              <Divider />
              {activeJobIds.map((jid) => (
                <PipelineProgress
                  key={jid}
                  jobId={jid}
                  onComplete={() => {
                    setTimeout(() => setActiveJobIds((prev) => prev.filter((id) => id !== jid)), 10000);
                  }}
                />
              ))}
            </BlockStack>
          </Card>
        )}

        {/* Stats */}
        <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
          <StatCard label="Completed" value={completed} icon={CheckCircleIcon} tone="success" />
          <StatCard label="Processing" value={processing} icon={StatusActiveIcon} tone="warning" />
          <StatCard label="Queued" value={queued} icon={ClockIcon} tone="info" />
          <StatCard label="Failed" value={failed} icon={AlertCircleIcon} tone="critical" />
        </InlineGrid>

        {/* Pipeline flow visualization */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Pipeline Flow</Text>
            <Divider />
            <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
              {STAGE_CONFIG.map((stage) => (
                <StageCard
                  key={stage.key}
                  icon={stage.icon}
                  label={stage.label}
                  description={stage.description}
                  count={stageCounts[stage.key] ?? 0}
                  tone={stage.tone}
                />
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Recent jobs table */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <Box background="bg-fill-secondary" borderRadius="200" padding="200">
                <Icon source={ClockIcon} />
              </Box>
              <Text as="h2" variant="headingMd">Recent Pipeline Jobs</Text>
            </InlineStack>
            <Divider />
            {jobs.length === 0 ? (
              <EmptyState heading="No pipeline jobs yet" image="">
                <Text as="p" tone="subdued">Enter a Shopify Product ID above to run the pipeline.</Text>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: 'job', plural: 'jobs' }}
                itemCount={jobs.length}
                headings={[
                  { title: 'Product' },
                  { title: 'Status' },
                  { title: 'Current Step' },
                  { title: 'Started' },
                  { title: 'Duration' },
                ]}
                selectable={false}
              >
                {jobs.map((job, idx) => (
                  <IndexTable.Row key={job.id} id={job.id} position={idx}>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {job.shopifyTitle ?? titleLookup?.[job.shopifyProductId] ?? `Product ${job.shopifyProductId}`}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{statusBadge(job.status)}</IndexTable.Cell>
                    <IndexTable.Cell><Text as="span">{resolveStepLabel(job)}</Text></IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">{formatTimestamp(job.startedAt ?? job.createdAt ?? null)}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">{formatDuration(job.startedAt ?? job.createdAt ?? null, job.completedAt ?? null)}</Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
};

export default Pipeline;
