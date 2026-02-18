import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, BlockStack, InlineStack, ProgressBar, Text } from '@shopify/polaris';
import { CheckCircle2, XCircle, Loader2, Circle } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface SSEEvent {
  type: 'snapshot' | 'step' | 'complete';
  jobId?: string;
  step?: string;
  status?: string;
  detail?: string;
  progress?: { current: number; total: number };
  timestamp?: string;
  jobStatus?: string;
  shopifyTitle?: string;
  job?: {
    id: string;
    status: string;
    currentStep?: string;
    shopifyTitle?: string;
    steps: Array<{ name: string; status: string; startedAt?: string; completedAt?: string; result?: string }>;
    startedAt?: number;
    completedAt?: number;
    error?: string;
  };
}

interface StepState {
  name: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: string;
  subDetail?: string;
  progress?: { current: number; total: number };
}

const STEP_CONFIG: Array<{ name: string; label: string }> = [
  { name: 'fetch_product', label: 'Shopify Import' },
  { name: 'generate_description', label: 'AI Description' },
  { name: 'process_images', label: 'Image Processing' },
  { name: 'create_ebay_listing', label: 'Draft Creation' },
];

const SECS_PER_IMAGE = 4;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface PipelineProgressProps {
  jobId: string;
  /** Called when job completes or fails */
  onComplete?: (status: 'completed' | 'failed', title?: string) => void;
  /** Compact mode for inline use */
  compact?: boolean;
}

const PipelineProgress: React.FC<PipelineProgressProps> = ({ jobId, onComplete, compact }) => {
  const [steps, setSteps] = useState<StepState[]>(
    STEP_CONFIG.map((s) => ({ name: s.name, label: s.label, status: 'pending' })),
  );
  const [jobStatus, setJobStatus] = useState<string>('queued');
  const [title, setTitle] = useState<string>('');
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [imageTotal, setImageTotal] = useState(0);
  const [sseConnected, setSseConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completeCalled = useRef(false);

  // Elapsed time ticker
  useEffect(() => {
    if (!startTime || jobStatus === 'completed' || jobStatus === 'failed') return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startTime, jobStatus]);

  const applySnapshot = useCallback((job: SSEEvent['job']) => {
    if (!job) return;
    setJobStatus(job.status);
    if (job.shopifyTitle) setTitle(job.shopifyTitle);
    if (job.startedAt) {
      const ms = job.startedAt > 1e12 ? job.startedAt : job.startedAt * 1000;
      setStartTime(ms);
    }
    setSteps((prev) =>
      prev.map((s) => {
        const match = job.steps.find((js) => js.name === s.name);
        return match
          ? { ...s, status: match.status as StepState['status'], result: match.result }
          : s;
      }),
    );
  }, []);

  const applyStepEvent = useCallback(
    (evt: SSEEvent) => {
      if (evt.shopifyTitle) setTitle(evt.shopifyTitle);
      if (evt.jobStatus) {
        setJobStatus(evt.jobStatus);
        if (
          (evt.jobStatus === 'completed' || evt.jobStatus === 'failed') &&
          !completeCalled.current
        ) {
          completeCalled.current = true;
          onComplete?.(evt.jobStatus as 'completed' | 'failed', evt.shopifyTitle);
        }
      }
      if (!startTime && evt.status === 'running') setStartTime(Date.now());

      setSteps((prev) =>
        prev.map((s) => {
          if (s.name !== evt.step) return s;
          return {
            ...s,
            status: (evt.status as StepState['status']) ?? s.status,
            result: evt.detail ?? s.result,
            subDetail: evt.progress
              ? `${evt.detail ?? ''}`
              : evt.status === 'running'
                ? evt.detail
                : s.subDetail,
            progress: evt.progress ?? s.progress,
          };
        }),
      );

      // Track image count for ETA
      if (evt.progress?.total && evt.step === 'process_images') {
        setImageTotal(evt.progress.total);
      }
    },
    [onComplete, startTime],
  );

  // SSE connection
  useEffect(() => {
    const es = new EventSource(`/api/pipeline/jobs/${jobId}/stream`);
    eventSourceRef.current = es;

    es.onopen = () => setSseConnected(true);
    es.onerror = () => {
      setSseConnected(false);
      // Fallback to polling
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(async () => {
          try {
            const res = await fetch(`/api/pipeline/jobs/${jobId}`);
            if (res.ok) {
              const job = await res.json();
              applySnapshot(job);
            }
          } catch {}
        }, 10000);
      }
    };
    es.onmessage = (msg) => {
      try {
        const data: SSEEvent = JSON.parse(msg.data);
        if (data.type === 'snapshot') applySnapshot(data.job);
        else applyStepEvent(data);
      } catch {}
    };

    return () => {
      es.close();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [jobId, applySnapshot, applyStepEvent]);

  // Progress calculation
  const progressPercent = useMemo(() => {
    const doneCount = steps.filter((s) => s.status === 'done').length;
    const runningStep = steps.find((s) => s.status === 'running');
    let partial = 0;
    if (runningStep?.progress) {
      partial = runningStep.progress.current / runningStep.progress.total;
    }
    return Math.round(((doneCount + partial * 0.9) / steps.length) * 100);
  }, [steps]);

  // ETA
  const etaText = useMemo(() => {
    if (jobStatus === 'completed') return 'Done';
    if (jobStatus === 'failed') return 'Failed';
    const currentStep = steps.find((s) => s.status === 'running');
    if (!currentStep) return '';
    if (currentStep.name === 'process_images' && imageTotal > 0 && currentStep.progress) {
      const remaining = imageTotal - currentStep.progress.current;
      const secs = remaining * SECS_PER_IMAGE;
      return secs > 60 ? `~${Math.ceil(secs / 60)}m remaining` : `~${secs}s remaining`;
    }
    return '';
  }, [steps, jobStatus, imageTotal]);

  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'done':
        return <CheckCircle2 size={18} color="#22c55e" />;
      case 'running':
        return <Loader2 size={18} color="#f59e0b" className="pipeline-spin" />;
      case 'error':
        return <XCircle size={18} color="#ef4444" />;
      default:
        return <Circle size={18} color="#d1d5db" />;
    }
  };

  if (compact) {
    return (
      <div style={{ padding: '12px 0' }}>
        <InlineStack gap="200" blockAlign="center">
          {steps.map((s) => (
            <span key={s.name} title={`${s.label}: ${s.status}`}>
              {statusIcon(s.status)}
            </span>
          ))}
          <Text as="span" variant="bodySm" tone="subdued">
            {title || jobId}
          </Text>
          {etaText && (
            <Badge tone="info">{etaText}</Badge>
          )}
        </InlineStack>
        <div style={{ marginTop: 6 }}>
          <ProgressBar progress={progressPercent} size="small" tone={jobStatus === 'failed' ? 'critical' : 'primary'} />
        </div>
      </div>
    );
  }

  return (
    <div className="pipeline-progress-container">
      {/* Header */}
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text as="h3" variant="headingMd">
            {title || 'Processing...'}
          </Text>
          <InlineStack gap="200">
            <Badge tone={jobStatus === 'completed' ? 'success' : jobStatus === 'failed' ? 'critical' : 'attention'}>
              {jobStatus}
            </Badge>
            {!sseConnected && <Badge tone="warning">Polling</Badge>}
          </InlineStack>
        </BlockStack>
        <BlockStack gap="050" inlineAlign="end">
          <Text as="span" variant="bodySm" tone="subdued">
            Elapsed: {formatElapsed(elapsed)}
          </Text>
          {etaText && (
            <Text as="span" variant="bodySm" tone="subdued">
              {etaText}
            </Text>
          )}
          {jobStatus === 'processing' && (
            <button
              onClick={async () => {
                try {
                  await fetch(`/api/pipeline/jobs/${jobId}/cancel`, { method: 'POST' });
                } catch { /* best effort */ }
              }}
              style={{
                marginTop: '4px',
                padding: '4px 12px',
                fontSize: '12px',
                background: '#dc2626',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              ✕ Cancel
            </button>
          )}
        </BlockStack>
      </InlineStack>

      {/* Progress bar */}
      <div style={{ margin: '16px 0' }}>
        <ProgressBar
          progress={progressPercent}
          size="small"
          tone={jobStatus === 'failed' ? 'critical' : 'primary'}
        />
      </div>

      {/* Steps */}
      <BlockStack gap="300">
        {steps.map((step) => (
          <div
            key={step.name}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '8px 12px',
              borderRadius: '8px',
              background:
                step.status === 'running'
                  ? 'rgba(245, 158, 11, 0.08)'
                  : step.status === 'done'
                    ? 'rgba(34, 197, 94, 0.05)'
                    : step.status === 'error'
                      ? 'rgba(239, 68, 68, 0.06)'
                      : 'transparent',
              transition: 'background 0.3s',
            }}
          >
            <div style={{ marginTop: 2 }}>{statusIcon(step.status)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {step.label}
              </Text>
              {step.subDetail && step.status === 'running' && (
                <div style={{ marginTop: 2 }}>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {step.subDetail}
                  </Text>
                </div>
              )}
              {step.progress && step.status === 'running' && (
                <div style={{ marginTop: 4, maxWidth: 200 }}>
                  <ProgressBar
                    progress={Math.round((step.progress.current / step.progress.total) * 100)}
                    size="small"
                  />
                </div>
              )}
              {step.status === 'done' && step.result && (
                <div style={{ marginTop: 2 }}>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {step.result}
                  </Text>
                </div>
              )}
              {step.status === 'error' && step.result && (
                <div style={{ marginTop: 2 }}>
                  <Text as="span" variant="bodySm" tone="critical">
                    {step.result}
                  </Text>
                </div>
              )}
            </div>
          </div>
        ))}
      </BlockStack>
    </div>
  );
};

export default PipelineProgress;
