import { IQueue, Job, QueueOptions } from './queue.interface';
import { v4 as uuidv4 } from 'uuid';

export class MemoryQueue<T = any> implements IQueue<T> {
  private waitingJobs: Job<T>[] = [];
  private activeJobs: Map<string, Job<T>> = new Map();
  private handler: ((job: Job<T>) => Promise<void>) | null = null;
  private concurrency = 1;
  private isProcessing = false;

  async addJob(name: string, data: T, options?: QueueOptions): Promise<string> {
    const jobId = (data as any).deployment_id || uuidv4();
    const newJob: Job<T> = {
      id: jobId,
      name,
      data,
      attemptsMade: 0
    };

    // Store options in job metadata for retry handling
    (newJob as any).options = options || {};

    this.waitingJobs.push(newJob);
    
    // Trigger processing asynchronously
    process.nextTick(() => this.triggerProcess());

    return jobId;
  }

  processJobs(handler: (job: Job<T>) => Promise<void>, concurrency = 1): void {
    this.handler = handler;
    this.concurrency = concurrency;
    this.triggerProcess();
  }

  async getWaitingCount(): Promise<number> {
    return this.waitingJobs.length;
  }

  async getActiveCount(): Promise<number> {
    return this.activeJobs.size;
  }

  private async triggerProcess(): Promise<void> {
    if (!this.handler || this.isProcessing) return;
    if (this.activeJobs.size >= this.concurrency) return;
    if (this.waitingJobs.length === 0) return;

    this.isProcessing = true;

    while (this.waitingJobs.length > 0 && this.activeJobs.size < this.concurrency) {
      const job = this.waitingJobs.shift()!;
      this.activeJobs.set(job.id, job);

      // Run job execution asynchronously
      this.runJob(job);
    }

    this.isProcessing = false;
  }

  private async runJob(job: Job<T>): Promise<void> {
    if (!this.handler) return;

    try {
      job.attemptsMade++;
      await this.handler(job);
      // Success
      this.activeJobs.delete(job.id);
    } catch (error) {
      console.error(`Job ${job.id} failed (attempt ${job.attemptsMade}):`, error);
      
      const opts = (job as any).options as QueueOptions;
      const maxAttempts = opts.attempts || 1;

      if (job.attemptsMade < maxAttempts) {
        // Retry with backoff
        const backoffDelay = this.calculateBackoff(job.attemptsMade, opts.backoff);
        console.log(`Re-queueing job ${job.id} in ${backoffDelay}ms`);
        
        this.activeJobs.delete(job.id);
        setTimeout(() => {
          this.waitingJobs.push(job);
          this.triggerProcess();
        }, backoffDelay);
      } else {
        // Exceeded attempts
        this.activeJobs.delete(job.id);
        console.error(`Job ${job.id} exceeded maximum attempts (${maxAttempts}). Failed permanently.`);
      }
    }

    // Trigger next job check
    this.triggerProcess();
  }

  private calculateBackoff(attempts: number, backoffOpts?: QueueOptions['backoff']): number {
    if (!backoffOpts) return 1000;
    const baseDelay = backoffOpts.delay || 1000;
    if (backoffOpts.type === 'exponential') {
      return baseDelay * Math.pow(2, attempts - 1);
    }
    return baseDelay;
  }
}
