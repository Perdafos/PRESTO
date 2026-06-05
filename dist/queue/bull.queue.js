"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BullQueue = void 0;
const config_1 = require("../config");
class BullQueue {
    queue;
    worker;
    constructor() {
        try {
            // Lazy load to prevent crash if bullmq is not installed/required
            const { Queue } = require('bullmq');
            const connection = {
                host: config_1.config.REDIS.host,
                port: config_1.config.REDIS.port
            };
            this.queue = new Queue('build-queue', {
                connection,
                defaultJobOptions: {
                    removeOnComplete: { age: 86400, count: 100 },
                    removeOnFail: { age: 604800 }
                }
            });
            console.log(`BullMQ initialized connected to Redis at ${config_1.config.REDIS.host}:${config_1.config.REDIS.port}`);
        }
        catch (error) {
            console.error('Failed to initialize BullMQ. Ensure bullmq npm package is installed and Redis is running:', error);
            throw error;
        }
    }
    async addJob(name, data, options) {
        if (!this.queue)
            throw new Error('BullMQ queue is not initialized');
        const bullOpts = {
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
    processJobs(handler, concurrency = 1) {
        const { Worker } = require('bullmq');
        const connection = {
            host: config_1.config.REDIS.host,
            port: config_1.config.REDIS.port
        };
        this.worker = new Worker('build-queue', async (bullJob) => {
            const job = {
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
        this.worker.on('failed', (job, err) => {
            console.error(`BullMQ job ${job?.id} failed:`, err.message);
        });
    }
    async getWaitingCount() {
        if (!this.queue)
            return 0;
        return await this.queue.getWaitingCount();
    }
    async getActiveCount() {
        if (!this.queue)
            return 0;
        return await this.queue.getActiveCount();
    }
}
exports.BullQueue = BullQueue;
