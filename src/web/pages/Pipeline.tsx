import React, { useCallback, useState } from 'react';
import {
  Badge,
  BlockStack,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Text,
  TextField,
} from '@shopify/polaris';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../hooks/useApi';
import {
  ShoppingBag,
  Sparkles,
  ImageIcon,
  Store,
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface PipelineJob {
  id: string;
  product: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  currentStep: string;
  started: string;
  completed: string | null;
}

interface PipelineJobsResponse {
  data: PipelineJob[];
}

/* ------------------------------------------------------------------ */
/* Sample data (used when the API isn't available yet)                  */
/* ------------------------------------------------------------------ */

const SAMPLE_JOBS: PipelineJob[] = [
  {
    id: '1',
    product: 'Canon EOS R5 Body',
    status: 'completed',
    currentStep: 'eBay Listing',
    started: new Date(Date.now() - 3600000).toISOString(),
    completed: new Date(Date.now() - 3000000).toISOString(),
  },
  {
    id: '2',
    product: 'Sony A7 IV Kit w/ 28-70mm',
    status: 'processing',
    currentStep: 'Image Processing',
    started: new Date(Date.now() - 1200000).toISOString(),
    completed: null,
  },
  {
    id: '3',
    product: 'Nikon Z6 III Body',
    status: 'processing',
    currentStep: 'AI Description',
    started: new Date(Date.now() - 600000).toISOString(),
    completed: null,
  },
  {
    id: '4',
    product: 'Fujifilm X-T5 Body (Silver)',
    status: 'queued',
    currentStep: 'Shopify Import',
    started: new Date(Date.now() - 120000).toISOString(),
    completed: null,
  },
  {
    id: '5',
    product: 'Leica Q3 43mm',
    status: 'failed',
    currentStep: 'Image Processing',
    started: new Date(Date.now() - 7200000).toISOString(),
    completed: new Date(Date.now() - 6800000).toISOString(),
  },
  {
    id: '6',
    product: 'DJI Mavic 3 Pro Combo',
    status: 'completed',
    currentStep: 'eBay Listing',
    started: new Date(Date.now() - 14400000).toISOString(),
    completed: new Date(Date.now() - 13800000).toISOString(),
  },
];

/* ------------------------------------------------------------------ */
/* Pipeline stage definitions                                          */
/* ------------------------------------------------------------------ */

interface PipelineStage {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  gradient: string;
  activeCount: number;
}

function buildStages(jobs: PipelineJob[]): PipelineStage[] {
  const countAtStep = (step: string, status?: string) =>
    jobs.filter(
      (j) =>
        j.currentStep === step &&
        (status ? j.status === status : j.status === 'processing' || j.status === 'queued'),
    ).length;

  return [
    {
      key: 'import',
      label: 'Shopify Import',
      description: 'Products ingested from Shopify catalog',
      icon: <ShoppingBag size={28} />,
      gradient: 'linear-gradient(135deg, #95bf47 0%, #5e8e3e 100%)',
      activeCount: countAtStep('Shopify Import'),
    },
    {
      key: 'ai',
      label: 'AI Description',
      description: 'Generate optimized listing copy',
      icon: <Sparkles size={28} />,
      gradient: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
      activeCount: countAtStep('AI Description'),
    },
    {
      key: 'images',
      label: 'Image Processing',
      description: 'PhotoRoom templates applied',
      icon: <ImageIcon size={28} />,
      gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      activeCount: countAtStep('Image Processing'),
    },
    {
      key: 'listing',
      label: 'eBay Listing',
      description: 'Published to eBay marketplace',
      icon: <Store size={28} />,
      gradient: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
      activeCount: countAtStep('eBay Listing'),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

const StageCard: React.FC<{ stage: PipelineStage; index: number }> = ({ stage, index }) => {
  return (
    <div className="pipeline-stage-card" style={{ animationDelay: `${index * 0.1}s` }}>
      {/* Glass card */}
      <div className="pipeline-glass-card">
        <div className="pipeline-stage-icon" style={{ background: stage.gradient }}>
          {stage.icon}
        </div>
        <div className="pipeline-stage-label">{stage.label}</div>
        <div className="pipeline-stage-desc">{stage.description}</div>
        {stage.activeCount > 0 && (
          <div className="pipeline-stage-badge">
            <span className="pipeline-badge-dot" />
            {stage.activeCount} active
          </div>
        )}
      </div>
    </div>
  );
};

const ConnectorArrow: React.FC<{ active: boolean }> = ({ active }) => (
  <div className="pipeline-connector">
    <div className={`pipeline-connector-line ${active ? 'pipeline-connector-active' : ''}`}>
      <div className="pipeline-connector-track" />
      {active && (
        <>
          <div className="pipeline-dot pipeline-dot-1" />
          <div className="pipeline-dot pipeline-dot-2" />
          <div className="pipeline-dot pipeline-dot-3" />
        </>
      )}
    </div>
    <ArrowRight size={18} className="pipeline-connector-arrow" />
  </div>
);

function statusBadge(status: string) {
  switch (status) {
    case 'completed':
      return <Badge tone="success">Completed</Badge>;
    case 'processing':
      return <Badge tone="attention">Processing</Badge>;
    case 'queued':
      return <Badge tone="info">Queued</Badge>;
    case 'failed':
      return <Badge tone="critical">Failed</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function statusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={16} color="#22c55e" />;
    case 'processing':
      return <Loader2 size={16} color="#f59e0b" className="pipeline-spin" />;
    case 'queued':
      return <Clock size={16} color="#6366f1" />;
    case 'failed':
      return <AlertTriangle size={16} color="#ef4444" />;
    default:
      return null;
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/* Main Pipeline page                                                  */
/* ------------------------------------------------------------------ */

const Pipeline: React.FC = () => {
  const [productId, setProductId] = useState('');
  const [triggerStatus, setTriggerStatus] = useState<{
    loading: boolean;
    result: null | { success: boolean; message: string; jobId?: string };
  }>({ loading: false, result: null });

  const handleRunPipeline = useCallback(async () => {
    const id = productId.trim();
    if (!id) return;
    setTriggerStatus({ loading: true, result: null });
    try {
      const res = await apiClient.post<{ jobId?: string; message?: string; error?: string }>(
        `/auto-list/${encodeURIComponent(id)}`,
      );
      setTriggerStatus({
        loading: false,
        result: {
          success: true,
          message: res.message || 'Pipeline job started',
          jobId: res.jobId,
        },
      });
    } catch (err: any) {
      setTriggerStatus({
        loading: false,
        result: {
          success: false,
          message: err?.message || 'Failed to start pipeline job',
        },
      });
    }
  }, [productId]);

  const { data } = useQuery({
    queryKey: ['pipeline-jobs'],
    queryFn: () => apiClient.get<PipelineJobsResponse>('/pipeline/jobs'),
    refetchInterval: 10000,
    retry: 1,
  });

  const jobs: PipelineJob[] = data?.data && data.data.length > 0 ? data.data : SAMPLE_JOBS;
  const usingDemo = !data?.data || data.data.length === 0;

  const stages = buildStages(jobs);
  const hasActiveFlow = stages.some((s) => s.activeCount > 0);

  // Stats
  const completed = jobs.filter((j) => j.status === 'completed').length;
  const processing = jobs.filter((j) => j.status === 'processing').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;

  return (
    <Page title="Pipeline Overview" subtitle="Real-time product automation flow">
      <BlockStack gap="600">
        {/* Process Product trigger */}
        <Card>
          <div style={{ padding: '16px' }}>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Process Product
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Enter a Shopify product ID to run it through the auto-listing pipeline.
              </Text>
              <InlineStack gap="300" blockAlign="end">
                <div style={{ flexGrow: 1, maxWidth: '360px' }}>
                  <TextField
                    label="Shopify Product ID"
                    labelHidden
                    value={productId}
                    onChange={setProductId}
                    placeholder="e.g. 8012345678901"
                    autoComplete="off"
                    connectedRight={
                      <Button
                        variant="primary"
                        onClick={handleRunPipeline}
                        loading={triggerStatus.loading}
                        disabled={!productId.trim()}
                      >
                        Run Pipeline
                      </Button>
                    }
                  />
                </div>
              </InlineStack>
              {triggerStatus.result && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: triggerStatus.result.success ? '#e8f5e9' : '#fce4ec',
                    color: triggerStatus.result.success ? '#2e7d32' : '#c62828',
                    fontSize: '14px',
                  }}
                >
                  {triggerStatus.result.success ? '✅' : '❌'} {triggerStatus.result.message}
                  {triggerStatus.result.jobId && (
                    <span style={{ marginLeft: '8px', opacity: 0.7 }}>
                      Job ID: {triggerStatus.result.jobId}
                    </span>
                  )}
                </div>
              )}
            </BlockStack>
          </div>
        </Card>
        {/* Stats bar */}
        <div className="pipeline-stats-bar">
          <div className="pipeline-stat">
            <div className="pipeline-stat-value pipeline-stat-completed">{completed}</div>
            <div className="pipeline-stat-label">Completed</div>
          </div>
          <div className="pipeline-stat">
            <div className="pipeline-stat-value pipeline-stat-processing">{processing}</div>
            <div className="pipeline-stat-label">Processing</div>
          </div>
          <div className="pipeline-stat">
            <div className="pipeline-stat-value pipeline-stat-queued">{queued}</div>
            <div className="pipeline-stat-label">Queued</div>
          </div>
          <div className="pipeline-stat">
            <div className="pipeline-stat-value pipeline-stat-failed">{failed}</div>
            <div className="pipeline-stat-label">Failed</div>
          </div>
        </div>

        {/* Pipeline visualization */}
        <Card>
          <div style={{ padding: '24px 16px' }}>
            {usingDemo && (
              <div style={{ marginBottom: '16px' }}>
                <Text as="p" tone="subdued" variant="bodySm">
                  Showing sample data — pipeline API not connected yet
                </Text>
              </div>
            )}
            <div className="pipeline-flow">
              {stages.map((stage, i) => (
                <React.Fragment key={stage.key}>
                  <StageCard stage={stage} index={i} />
                  {i < stages.length - 1 && (
                    <ConnectorArrow active={hasActiveFlow} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </Card>

        {/* Recent jobs table */}
        <Card>
          <div style={{ padding: '16px' }}>
            <BlockStack gap="400">
              <Text as="p" variant="headingMd">
                Recent Pipeline Jobs
              </Text>
              <IndexTable
                resourceName={{ singular: 'job', plural: 'jobs' }}
                itemCount={jobs.length}
                headings={[
                  { title: 'Product' },
                  { title: 'Status' },
                  { title: 'Current Step' },
                  { title: 'Started' },
                  { title: 'Completed' },
                ]}
                selectable={false}
              >
                {jobs.map((job, idx) => (
                  <IndexTable.Row key={job.id} id={job.id} position={idx}>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {job.product}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        {statusIcon(job.status)}
                        {statusBadge(job.status)}
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span">{job.currentStep}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">
                        {timeAgo(job.started)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">
                        {job.completed ? timeAgo(job.completed) : '—'}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </BlockStack>
          </div>
        </Card>
      </BlockStack>
    </Page>
  );
};

export default Pipeline;
