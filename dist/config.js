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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
// Load .env
dotenv.config();
exports.config = {
    PORT: parseInt(process.env.PORT || '3000', 10),
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || 'github_webhook_secret_key_here',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'my_secure_32_char_encryption_key_',
    REDIS: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
    MAX_CONCURRENT_BUILDS: parseInt(process.env.MAX_CONCURRENT_BUILDS || '3', 10),
    PORT_RANGE: {
        start: parseInt(process.env.PORT_RANGE_START || '10000', 10),
        end: parseInt(process.env.PORT_RANGE_END || '20000', 10),
    },
    BUILDS_DIR: path.join(process.cwd(), 'builds'),
    NGINX: {
        confDir: process.env.NGINX_CONF_DIR || '/etc/nginx/conf.d',
        upstreamHost: process.env.NGINX_UPSTREAM_HOST || '127.0.0.1',
        reloadCmd: process.env.NGINX_RELOAD_CMD || 'nginx -s reload',
    },
};
