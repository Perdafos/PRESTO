import { IQueue } from './queue.interface';
import { BullQueue } from './bull.queue';

console.log('[Queue] Loaded BullQueue.');
const queue: IQueue = new BullQueue();

export { queue };
export * from './queue.interface';
