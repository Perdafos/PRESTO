import { IQueue } from './queue.interface';
import { MemoryQueue } from './memory.queue';
import { config } from '../config';

let queue: IQueue;

if (config.SIMULATION_MODE) {
  console.log('[Queue] Running in SIMULATION_MODE. Using MemoryQueue.');
  queue = new MemoryQueue();
} else {
  try {
    const { BullQueue } = require('./bull.queue');
    queue = new BullQueue();
    console.log('[Queue] Loaded BullQueue.');
  } catch (error) {
    console.warn('[Queue] Failed to load BullQueue, falling back to MemoryQueue:', error);
    queue = new MemoryQueue();
  }
}

export { queue };
export * from './queue.interface';
export * from './memory.queue';
