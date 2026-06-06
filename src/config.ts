import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env
dotenv.config();

export const config = {
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
