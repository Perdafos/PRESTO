"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BullQueue = void 0;
const config_1 = require("../config");
const bullmq_1 = require("bullmq");
class BullQueue {
    queue;
    worker;
    constructor() {
        const connection = {
            host: config_1.config.REDIS.host,
            port: config_1.config.REDIS.port
        };
        this.queue = new bullmq_1.Queue('build-queue', {
            connection,
            defaultJobOptions: {
                removeOnComplete: { age: 86400, count: 100 },
                removeOnFail: { age: 604800 }
            }
        });
        console.log(`BullMQ initialized connected to Redis at ${config_1.config.REDIS.host}:${config_1.config.REDIS.port}`);
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
        const connection = {
            host: config_1.config.REDIS.host,
            port: config_1.config.REDIS.port
        };
        this.worker = new bullmq_1.Worker('build-queue', async (bullJob) => {
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
