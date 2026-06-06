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
exports.nginxService = exports.NginxService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const db_1 = require("../db");
const config_1 = require("../config");
const execPromise = util.promisify(child_process_1.exec);
class NginxService {
    /**
     * Configures a routing rule in Nginx for a project domain.
     */
    async upsertRoute(projectId, deploymentId, domain, allocatedPort) {
        db_1.db.appendDeploymentLog(deploymentId, `Configuring Nginx proxy: http://${domain} -> http://${config_1.config.NGINX.upstreamHost}:${allocatedPort}`);
        // Ensure config directory exists
        if (!fs.existsSync(config_1.config.NGINX.confDir)) {
            fs.mkdirSync(config_1.config.NGINX.confDir, { recursive: true });
        }
        const confPath = path.join(config_1.config.NGINX.confDir, `project_${projectId}.conf`);
        const nginxConfig = `server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://${config_1.config.NGINX.upstreamHost}:${allocatedPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Deployment-ID "${deploymentId}";

        # WebSockets Support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
`;
        try {
            db_1.db.appendDeploymentLog(deploymentId, `Writing Nginx configuration to ${confPath}`);
            fs.writeFileSync(confPath, nginxConfig, 'utf-8');
            db_1.db.appendDeploymentLog(deploymentId, `Executing Nginx reload command: ${config_1.config.NGINX.reloadCmd}`);
            const { stdout, stderr } = await execPromise(config_1.config.NGINX.reloadCmd);
            if (stderr && stderr.trim()) {
                db_1.db.appendDeploymentLog(deploymentId, `Nginx reload stderr: ${stderr}`);
            }
            db_1.db.appendDeploymentLog(deploymentId, `Nginx routing update succeeded. Domain active.`);
        }
        catch (err) {
            db_1.db.appendDeploymentLog(deploymentId, `Nginx routing update failed: ${err.message}`);
            throw err;
        }
    }
    /**
     * Removes a routing rule.
     */
    async deleteRoute(projectId) {
        const confPath = path.join(config_1.config.NGINX.confDir, `project_${projectId}.conf`);
        try {
            if (fs.existsSync(confPath)) {
                fs.unlinkSync(confPath);
                console.log(`Deleted Nginx config file: ${confPath}`);
                console.log(`Executing Nginx reload command: ${config_1.config.NGINX.reloadCmd}`);
                await execPromise(config_1.config.NGINX.reloadCmd);
                console.log(`Nginx route route_${projectId} successfully deleted.`);
            }
            else {
                console.log(`Nginx config file not found, skipping delete: ${confPath}`);
            }
        }
        catch (err) {
            console.error(`Failed to delete Nginx route: ${err.message}`);
        }
    }
}
exports.NginxService = NginxService;
exports.nginxService = new NginxService();
