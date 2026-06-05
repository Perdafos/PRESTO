export interface Job<T = any> {
  id: string;
  name: string;
  data: T;
  attemptsMade: number;
}

export interface QueueOptions {
  attempts?: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  priority?: number;
}

export interface IQueue<T = any> {
  addJob(name: string, data: T, options?: QueueOptions): Promise<string>;
  processJobs(handler: (job: Job<T>) => Promise<void>, concurrency?: number): void;
  getWaitingCount(): Promise<number>;
  getActiveCount(): Promise<number>;
}
