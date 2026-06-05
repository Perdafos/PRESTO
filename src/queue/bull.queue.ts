import { IQueue, Job, QueueOptions } from './queue.interface';
import { config } from '../config';

export class BullQueue<T = any> implements IQueue<T> {
  private queue: any;
  private worker: any;

  constructor() {
    try {
      // Lazy load to prevent crash if bullmq is not installed/required
      const { Queue } = require('bullmq');
      
      const connection = {
        host: config.REDIS.host,
        port: config.REDIS.port
      };

      this.queue = new Queue('build-queue', {
        connection,
        defaultJobOptions: {
          removeOnComplete: { age: 86400, count: 100 },
          removeOnFail: { age: 604800 }
        }
      });

      console.log(`BullMQ initialized connected to Redis at ${config.REDIS.host}:${config.REDIS.port}`);
    } catch (error) {
      console.error('Failed to initialize BullMQ. Ensure bullmq npm package is installed and Redis is running:', error);
      throw error;
    }
  }

  async addJob(name: string, data: T, options?: QueueOptions): Promise<string> {
    if (!this.queue) throw new Error('BullMQ queue is not initialized');
    
    const bullOpts: any = {
      attempts: options?.attempts || 3,
      backoff: options?.backoff ? {
        type: options.backoff.type,
        delay: options.backoff.delay
      } : undefined,
      priority: options?.priority
    };

    const job = await this.queue.add(name, data, bullOpts);
    return job.id || '';
  }

  processJobs(handler: (job: Job<T>) => Promise<void>, concurrency = 1): void {
    const { Worker } = require('bullmq');
    
    const connection = {
      host: config.REDIS.host,
      port: config.REDIS.port
    };

    this.worker = new Worker('build-queue', async (bullJob: any) => {
      const job: Job<T> = {
        id: bullJob.id || '',
        name: bullJob.name,
        data: bullJob.data,
        attemptsMade: bullJob.attemptsMade
      };
      await handler(job);
    }, {
      connection,
      concurrency
    });

    this.worker.on('failed', (job: any, err: Error) => {
      console.error(`BullMQ job ${job?.id} failed:`, err.message);
    });
  }

  async getWaitingCount(): Promise<number> {
    if (!this.queue) return 0;
    return await this.queue.getWaitingCount();
  }

  async getActiveCount(): Promise<number> {
    if (!this.queue) return 0;
    return await this.queue.getActiveCount();
  }
}
