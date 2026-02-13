import { info } from '../utils/logger.js';
import { getRawDb } from '../db/client.js';

// ---------------------------------------------------------------------------
// Pipeline Status — in-memory job tracking for the auto-listing pipeline
// ---------------------------------------------------------------------------

export type StepName =
  | 'fetch_product'
  | 'generate_description'
  | 'process_images'
  | 'create_ebay_listing';

export type StepStatus = 'pending' | 'running' | 'done' | 'error';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

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
  'generate_description',
  'process_images',
  'create_ebay_listing',
];

const STEP_LABELS: Record<StepName, string> = {
  fetch_product: 'Shopify Import',
  generate_description: 'AI Description',
  process_images: 'Image Processing',
  create_ebay_listing: 'eBay Listing',
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
}

export async function setPipelineJobTitle(jobId: string, title: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  job.shopifyTitle = title;
  job.updatedAt = new Date().toISOString();
  await persistJob(job);
}
