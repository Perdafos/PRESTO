"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryQueue = void 0;
const uuid_1 = require("uuid");
class MemoryQueue {
    waitingJobs = [];
    activeJobs = new Map();
    handler = null;
    concurrency = 1;
    isProcessing = false;
    async addJob(name, data, options) {
        const jobId = data.deployment_id || (0, uuid_1.v4)();
        const newJob = {
            id: jobId,
            name,
            data,
            attemptsMade: 0
        };
        // Store options in job metadata for retry handling
        newJob.options = options || {};
        this.waitingJobs.push(newJob);
        // Trigger processing asynchronously
        process.nextTick(() => this.triggerProcess());
        return jobId;
    }
    processJobs(handler, concurrency = 1) {
        this.handler = handler;
        this.concurrency = concurrency;
        this.triggerProcess();
    }
    async getWaitingCount() {
        return this.waitingJobs.length;
    }
    async getActiveCount() {
        return this.activeJobs.size;
    }
    async triggerProcess() {
        if (!this.handler || this.isProcessing)
            return;
        if (this.activeJobs.size >= this.concurrency)
            return;
        if (this.waitingJobs.length === 0)
            return;
        this.isProcessing = true;
        while (this.waitingJobs.length > 0 && this.activeJobs.size < this.concurrency) {
            const job = this.waitingJobs.shift();
            this.activeJobs.set(job.id, job);
            // Run job execution asynchronously
            this.runJob(job);
        }
        this.isProcessing = false;
    }
    async runJob(job) {
        if (!this.handler)
            return;
        try {
            job.attemptsMade++;
            await this.handler(job);
            // Success
            this.activeJobs.delete(job.id);
        }
        catch (error) {
            console.error(`Job ${job.id} failed (attempt ${job.attemptsMade}):`, error);
            const opts = job.options;
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
            }
            else {
                // Exceeded attempts
                this.activeJobs.delete(job.id);
                console.error(`Job ${job.id} exceeded maximum attempts (${maxAttempts}). Failed permanently.`);
            }
        }
        // Trigger next job check
        this.triggerProcess();
    }
    calculateBackoff(attempts, backoffOpts) {
        if (!backoffOpts)
            return 1000;
        const baseDelay = backoffOpts.delay || 1000;
        if (backoffOpts.type === 'exponential') {
            return baseDelay * Math.pow(2, attempts - 1);
        }
        return baseDelay;
    }
}
exports.MemoryQueue = MemoryQueue;
