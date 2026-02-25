import { EventEmitter } from 'node:events';
export type StepName = 'fetch_product' | 'tim_condition' | 'drive_search' | 'generate_description' | 'process_images' | 'create_ebay_listing';
export type StepStatus = 'pending' | 'running' | 'done' | 'error';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export interface PipelineEvent {
    jobId: string;
    step: StepName;
    status: StepStatus;
    detail?: string;
    progress?: {
        current: number;
        total: number;
    };
    timestamp: string;
    jobStatus?: JobStatus;
    shopifyTitle?: string;
}
export declare const pipelineEvents: EventEmitter<[never]>;
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
/** Create a new pipeline job and return its ID. */
export declare function createPipelineJob(shopifyProductId: string): Promise<string>;
/** Get all pipeline jobs (most recent first). */
export declare function getPipelineJobs(): PipelineJob[];
/** Get a single pipeline job by ID. */
export declare function getPipelineJob(id: string): PipelineJob | undefined;
/** Mark the overall job as processing. */
export declare function startPipelineJob(jobId: string): Promise<void>;
/** Update a specific step within a job. */
export declare function updatePipelineStep(jobId: string, stepName: StepName, status: StepStatus, result?: string): Promise<void>;
/** Emit a progress sub-event (e.g. image 3/7) without changing step status. */
export declare function emitProgress(jobId: string, stepName: StepName, current: number, total: number, detail?: string): void;
export declare function setPipelineJobTitle(jobId: string, title: string): Promise<void>;
/** Cancel a pipeline job — marks it as failed with cancellation message. */
export declare function cancelPipelineJob(jobId: string): boolean;
/** Clean up stuck jobs — any job processing for more than 10 minutes is marked failed. */
export declare function cleanupStuckJobs(): number;
