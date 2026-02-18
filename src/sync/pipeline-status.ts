import { EventEmitter } from 'node:events';
import { info } from '../utils/logger.js';
import { getRawDb } from '../db/client.js';

// ---------------------------------------------------------------------------
// Pipeline Status — in-memory job tracking for the auto-listing pipeline
// ---------------------------------------------------------------------------

export type StepName =
  | 'fetch_product'
  | 'tim_condition'
  | 'drive_search'
  | 'generate_description'
  | 'process_images'
  | 'create_ebay_listing';

export type StepStatus = 'pending' | 'running' | 'done' | 'error';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

// ---------------------------------------------------------------------------
// Event emitter for real-time SSE streaming
// ---------------------------------------------------------------------------

export interface PipelineEvent {
  jobId: string;
  step: StepName;
  status: StepStatus;
  detail?: string;
  progress?: { current: number; total: number };
  timestamp: string;
  jobStatus?: JobStatus;
  shopifyTitle?: string;
}

export const pipelineEvents = new EventEmitter();
pipelineEvents.setMaxListeners(100);

export interface PipelineStep {
  name: StepName;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  result?: string;
}

export interface PipelineJob {
  id: string;
  shopifyProductId: string;
  shopifyTitle?: string;
  status: JobStatus;
  currentStep?: string;
  steps: PipelineStep[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

// In-memory store (max 200 jobs to avoid leaks)
const MAX_JOBS = 200;
const jobs: Map<string, PipelineJob> = new Map();

const STEP_NAMES: StepName[] = [
  'fetch_product',
  'tim_condition',
  'drive_search',
  'generate_description',
  'process_images',
  'create_ebay_listing',
];

const STEP_LABELS: Record<StepName, string> = {
  fetch_product: 'Fetch Product',
  tim_condition: 'TIM Condition',
  drive_search: 'Search Drive',
  generate_description: 'Generate Description',
  process_images: 'Process Images',
  create_ebay_listing: 'Save Draft',
};

const toEpochSeconds = (iso?: string) =>
  iso ? Math.floor(new Date(iso).getTime() / 1000) : undefined;

const serializeSteps = (steps: PipelineStep[]) => JSON.stringify(steps);

const persistJob = async (job: PipelineJob) => {
  const db = await getRawDb();
  const createdAt = toEpochSeconds(job.createdAt) ?? Math.floor(Date.now() / 1000);
  const updatedAt = toEpochSeconds(job.updatedAt) ?? createdAt;

  db.prepare(
    `INSERT INTO pipeline_jobs
      (id, shopify_product_id, shopify_title, status, current_step, steps_json, started_at, completed_at, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
      shopify_product_id = excluded.shopify_product_id,
      shopify_title = excluded.shopify_title,
      status = excluded.status,
      current_step = excluded.current_step,
      steps_json = excluded.steps_json,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      error = excluded.error,
      updated_at = excluded.updated_at`,
  ).run(
    job.id,
    job.shopifyProductId,
    job.shopifyTitle ?? null,
    job.status,
    job.currentStep ?? null,
    serializeSteps(job.steps),
    toEpochSeconds(job.startedAt),
    toEpochSeconds(job.completedAt),
    job.error ?? null,
    createdAt,
    updatedAt,
  );
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create a new pipeline job and return its ID. */
export async function createPipelineJob(shopifyProductId: string): Promise<string> {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const job: PipelineJob = {
    id,
    shopifyProductId,
    status: 'queued',
    currentStep: STEP_LABELS.fetch_product,
    steps: STEP_NAMES.map((name) => ({ name, status: 'pending' as StepStatus })),
    createdAt: now,
    updatedAt: now,
  };

  // Evict oldest if at capacity
  if (jobs.size >= MAX_JOBS) {
    const oldest = jobs.keys().next().value;
    if (oldest) jobs.delete(oldest);
  }

  jobs.set(id, job);
  info(`[Pipeline] Created job ${id} for product ${shopifyProductId}`);
  await persistJob(job);
  return id;
}

/** Get all pipeline jobs (most recent first). */
export function getPipelineJobs(): PipelineJob[] {
  return Array.from(jobs.values()).reverse();
}

/** Get a single pipeline job by ID. */
export function getPipelineJob(id: string): PipelineJob | undefined {
  return jobs.get(id);
}

/** Mark the overall job as processing. */
export async function startPipelineJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'processing';
  job.startedAt = job.startedAt ?? new Date().toISOString();
  job.updatedAt = new Date().toISOString();
  await persistJob(job);
}

/** Update a specific step within a job. */
export async function updatePipelineStep(
  jobId: string,
  stepName: StepName,
  status: StepStatus,
  result?: string,
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  const step = job.steps.find((s) => s.name === stepName);
  if (!step) return;

  step.status = status;
  if (status === 'running') {
    step.startedAt = new Date().toISOString();
  }
  if (status === 'done' || status === 'error') {
    step.completedAt = new Date().toISOString();
  }
  if (result !== undefined) {
    step.result = result;
  }

  if (status === 'running') {
    job.currentStep = STEP_LABELS[stepName];
  }
  if (status === 'error') {
    job.error = result ?? job.error;
  }

  // Derive overall job status
  const allDone = job.steps.every((s) => s.status === 'done');
  const anyError = job.steps.some((s) => s.status === 'error');

  if (allDone) {
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
  } else if (anyError) {
    job.status = 'failed';
    job.completedAt = new Date().toISOString();
  } else {
    job.status = 'processing';
  }

  job.updatedAt = new Date().toISOString();
  await persistJob(job);

  // Emit real-time event for SSE subscribers
  const event: PipelineEvent = {
    jobId,
    step: stepName,
    status,
    detail: result,
    timestamp: new Date().toISOString(),
    jobStatus: job.status,
    shopifyTitle: job.shopifyTitle,
  };
  pipelineEvents.emit(`job:${jobId}`, event);
  pipelineEvents.emit('job:*', event);
}

/** Emit a progress sub-event (e.g. image 3/7) without changing step status. */
export function emitProgress(
  jobId: string,
  stepName: StepName,
  current: number,
  total: number,
  detail?: string,
): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const event: PipelineEvent = {
    jobId,
    step: stepName,
    status: 'running',
    detail,
    progress: { current, total },
    timestamp: new Date().toISOString(),
    jobStatus: job.status,
    shopifyTitle: job.shopifyTitle,
  };
  pipelineEvents.emit(`job:${jobId}`, event);
  pipelineEvents.emit('job:*', event);
}

export async function setPipelineJobTitle(jobId: string, title: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  job.shopifyTitle = title;
  job.updatedAt = new Date().toISOString();
  await persistJob(job);
}

/** Cancel a pipeline job — marks it as failed with cancellation message. */
export function cancelPipelineJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (job.status !== 'processing' && job.status !== 'queued') return false;
  job.status = 'failed';
  const now = new Date().toISOString();
  for (const step of job.steps) {
    if (step.status === 'running') {
      step.status = 'error';
      step.result = 'Cancelled by user';
      step.completedAt = now;
    } else if (step.status === 'pending') {
      step.status = 'error';
      step.result = 'Cancelled';
      step.completedAt = now;
    }
  }
  pipelineEvents.emit('step', { jobId, step: 'cancelled', status: 'error', message: 'Job cancelled by user' });
  return true;
}

/** Clean up stuck jobs — any job processing for more than 10 minutes is marked failed. */
export function cleanupStuckJobs(): number {
  const TEN_MINUTES = 10 * 60 * 1000;
  const now = Date.now();
  let cleaned = 0;
  for (const [, job] of jobs) {
    if ((job.status === 'processing' || job.status === 'queued') && job.steps[0]?.startedAt) {
      const startTime = new Date(job.steps[0].startedAt).getTime();
      if (now - startTime > TEN_MINUTES) {
        cancelPipelineJob(job.id);
        cleaned++;
      }
    }
  }
  return cleaned;
}

// Auto-cleanup every 2 minutes
setInterval(() => cleanupStuckJobs(), 2 * 60 * 1000);
