"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queue = void 0;
const memory_queue_1 = require("./memory.queue");
const config_1 = require("../config");
let queue;
if (config_1.config.SIMULATION_MODE) {
    console.log('[Queue] Running in SIMULATION_MODE. Using MemoryQueue.');
    exports.queue = queue = new memory_queue_1.MemoryQueue();
}
else {
    try {
        const { BullQueue } = require('./bull.queue');
        exports.queue = queue = new BullQueue();
        console.log('[Queue] Loaded BullQueue.');
    }
    catch (error) {
        console.warn('[Queue] Failed to load BullQueue, falling back to MemoryQueue:', error);
        exports.queue = queue = new memory_queue_1.MemoryQueue();
    }
}
__exportStar(require("./queue.interface"), exports);
__exportStar(require("./memory.queue"), exports);
