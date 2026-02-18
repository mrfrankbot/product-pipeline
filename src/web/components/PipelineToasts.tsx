import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Persistent pipeline status bar.
 * Sticks to the bottom of the screen showing all active pipeline jobs
 * with real-time progress. Stays visible until jobs complete, then
 * shows completion status for 10 seconds before fading.
 */

interface ActiveJob {
  jobId: string;
  title: string;
  status: 'running' | 'completed' | 'failed';
  currentStep: string;
  detail: string;
  progress?: { current: number; total: number };
  startedAt: number;
  completedAt?: number;
}

const PipelineToasts: React.FC = () => {
  const [jobs, setJobs] = useState<Map<string, ActiveJob>>(new Map());
  const cleanupTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const updateJob = useCallback((jobId: string, updates: Partial<ActiveJob>) => {
    setJobs((prev) => {
      const next = new Map(prev);
      const existing = next.get(jobId) || {
        jobId,
        title: jobId,
        status: 'running' as const,
        currentStep: '',
        detail: '',
        startedAt: Date.now(),
      };
      next.set(jobId, { ...existing, ...updates });
      return next;
    });
  }, []);

  const removeJob = useCallback((jobId: string) => {
    setJobs((prev) => {
      const next = new Map(prev);
      next.delete(jobId);
      return next;
    });
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/pipeline/stream');

    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        const { jobId, step, status, detail, progress, jobStatus, shopifyTitle } = data;
        const title = shopifyTitle || jobId;

        if (!jobId) return;

        // Job started
        if (step === 'fetch_product' && status === 'running') {
          // Clear any pending removal timer
          const timer = cleanupTimers.current.get(jobId);
          if (timer) { clearTimeout(timer); cleanupTimers.current.delete(jobId); }
          updateJob(jobId, { title, status: 'running', currentStep: 'Fetching product...', detail: '' });
        }

        // Step updates
        const stepLabels: Record<string, string> = {
          fetch_product: 'Importing from Shopify',
          generate_description: 'Generating AI description',
          process_images: 'Processing photos',
          create_ebay_listing: 'Creating draft',
        };

        if (step && status === 'running') {
          const stepLabel = stepLabels[step] || step;
          const progressText = progress ? ` (${progress.current}/${progress.total})` : '';
          updateJob(jobId, {
            title,
            status: 'running',
            currentStep: stepLabel + progressText,
            detail: detail || '',
            progress: progress || undefined,
          });
        }

        if (step && status === 'done') {
          const stepLabel = stepLabels[step] || step;
          updateJob(jobId, {
            title,
            currentStep: `✅ ${stepLabel}`,
            detail: detail || '',
          });
        }

        // TIM condition
        if (detail?.includes('condition:') || detail?.includes('Condition')) {
          updateJob(jobId, { detail });
        }

        // Completed
        if (jobStatus === 'completed') {
          updateJob(jobId, {
            title,
            status: 'completed',
            currentStep: '✅ Draft ready for review',
            detail: detail || '',
            completedAt: Date.now(),
          });
          // Auto-remove after 10 seconds
          const timer = setTimeout(() => removeJob(jobId), 10000);
          cleanupTimers.current.set(jobId, timer);
        }

        // Failed
        if (jobStatus === 'failed') {
          updateJob(jobId, {
            title,
            status: 'failed',
            currentStep: '❌ Failed',
            detail: detail || 'Unknown error',
            completedAt: Date.now(),
          });
          // Auto-remove after 15 seconds
          const timer = setTimeout(() => removeJob(jobId), 15000);
          cleanupTimers.current.set(jobId, timer);
        }
      } catch {}
    };

    return () => {
      es.close();
      cleanupTimers.current.forEach((t) => clearTimeout(t));
    };
  }, [updateJob, removeJob]);

  const activeJobs = Array.from(jobs.values());
  if (activeJobs.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      gap: '1px',
    }}>
      {activeJobs.map((job) => {
        const elapsed = Math.floor(((job.completedAt || Date.now()) - job.startedAt) / 1000);
        const bgColor = job.status === 'completed' ? '#16a34a'
          : job.status === 'failed' ? '#dc2626'
          : '#1a1a1a';

        return (
          <div key={job.jobId} style={{
            background: bgColor,
            color: 'white',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '13px',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            transition: 'background 0.3s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              {job.status === 'running' && (
                <div style={{
                  width: '8px', height: '8px',
                  borderRadius: '50%',
                  background: '#fbbf24',
                  animation: 'pulse 1.5s infinite',
                }} />
              )}
              <span style={{ fontWeight: 600 }}>{job.title}</span>
              <span style={{ opacity: 0.8 }}>—</span>
              <span>{job.currentStep}</span>
              {job.detail && job.status === 'running' && (
                <span style={{ opacity: 0.6, fontSize: '12px' }}>{job.detail}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {job.progress && job.status === 'running' && (
                <div style={{
                  width: '100px', height: '4px',
                  background: 'rgba(255,255,255,0.2)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${(job.progress.current / job.progress.total) * 100}%`,
                    height: '100%',
                    background: '#fbbf24',
                    borderRadius: '2px',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              )}
              <span style={{ opacity: 0.6, fontSize: '12px' }}>
                {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}
              </span>
              {job.status === 'running' && (
                <button
                  onClick={async () => {
                    try {
                      await fetch(`/api/pipeline/jobs/${job.jobId}/cancel`, { method: 'POST' });
                      removeJob(job.jobId);
                    } catch {}
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.15)',
                    border: 'none',
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  ✕
                </button>
              )}
              {job.status !== 'running' && (
                <button
                  onClick={() => removeJob(job.jobId)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.6)',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};

export default PipelineToasts;
