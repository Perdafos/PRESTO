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
exports.startWorker = startWorker;
const index_1 = require("./index");
const db_1 = require("../db");
const git_1 = require("../services/git");
const detector_1 = require("../services/detector");
const docker_1 = require("../services/docker");
const nginx_1 = require("../services/nginx");
const crypto_1 = require("../services/crypto");
const notifier_1 = require("../services/notifier");
const config_1 = require("../config");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
function startWorker() {
    console.log('[Worker] Starting background worker listener...');
    index_1.queue.processJobs(async (job) => {
        const payload = job.data;
        const { deployment_id, project_id, domain, is_private, ssh_key_ref } = payload;
        console.log(`[Worker] Processing deployment job: ${deployment_id} for project ${project_id}`);
        let currentPhase = 'queued';
        let allocatedPort = 0;
        let newContainerStarted = false;
        try {
            // --- Capacity Checks ---
            currentPhase = 'queued';
            const freeMemGb = os.freemem() / (1024 * 1024 * 1024);
            const loadAvg = os.loadavg();
            db_1.db.appendDeploymentLog(deployment_id, `System load average: ${loadAvg[0].toFixed(2)}. Free memory: ${freeMemGb.toFixed(2)} GB.`);
            if (freeMemGb < 0.5) {
                db_1.db.appendDeploymentLog(deployment_id, `WARNING: Low system memory (${freeMemGb.toFixed(2)} GB free). Proceeding with caution.`);
            }
            // --- Phase 1: Git Clone ---
            currentPhase = 'cloning';
            db_1.db.updateDeploymentStatus(deployment_id, 'cloning');
            const sourceDir = await git_1.gitService.clone(deployment_id, payload.repo_clone_url, payload.deployment_branch, is_private, ssh_key_ref);
            // --- Phase 2: Framework Detection ---
            currentPhase = 'detecting';
            db_1.db.updateDeploymentStatus(deployment_id, 'detecting');
            const detectResult = await detector_1.detectorService.detect(deployment_id, sourceDir);
            // --- Phase 3: Docker Build ---
            currentPhase = 'building';
            db_1.db.updateDeploymentStatus(deployment_id, 'building');
            const dockerfilePath = path.join(config_1.config.BUILDS_DIR, deployment_id, 'docker/Dockerfile');
            await docker_1.dockerService.build(project_id, payload.commit_sha, deployment_id, sourceDir, dockerfilePath);
            // --- Phase 4: Prepare & Allocate Port ---
            currentPhase = 'starting';
            db_1.db.updateDeploymentStatus(deployment_id, 'starting');
            // 1. Allocate dynamic port or use custom port
            const project = db_1.db.getProject(project_id);
            if (project && project.port) {
                allocatedPort = parseInt(project.port, 10);
                db_1.db.appendDeploymentLog(deployment_id, `Using configured custom host port: ${allocatedPort}`);
            }
            else {
                allocatedPort = allocateDynamicPort(project_id);
                db_1.db.appendDeploymentLog(deployment_id, `Allocated dynamic host port: ${allocatedPort}`);
            }
            // 2. Decrypt environment variables
            let envVars = {};
            if (payload.env_vars_encrypted) {
                db_1.db.appendDeploymentLog(deployment_id, `Decrypting environment variables...`);
                try {
                    const decryptedJson = (0, crypto_1.decrypt)(payload.env_vars_encrypted, config_1.config.ENCRYPTION_KEY);
                    envVars = JSON.parse(decryptedJson);
                }
                catch (err) {
                    throw new Error(`Environment variables decryption failed: ${err.message}`);
                }
            }
            // Add auto-injected system envs
            envVars['APP_ENV'] = 'production';
            envVars['PORT'] = detectResult.internalPort.toString();
            envVars['PLATFORM_DEPLOYMENT_ID'] = deployment_id;
            // 3. Start the container
            await docker_1.dockerService.run(project_id, deployment_id, payload.commit_sha, allocatedPort, detectResult.internalPort, envVars);
            newContainerStarted = true;
            // --- Phase 5: Health Checking ---
            currentPhase = 'health_checking';
            db_1.db.updateDeploymentStatus(deployment_id, 'health_checking');
            await performHealthCheck(deployment_id, allocatedPort);
            // --- Phase 6: Dynamic Routing Configuration ---
            currentPhase = 'updating_routing';
            db_1.db.updateDeploymentStatus(deployment_id, 'updating_routing');
            await nginx_1.nginxService.upsertRoute(project_id, deployment_id, domain, allocatedPort);
            // --- Phase 7: Live & Cleanup ---
            currentPhase = 'live';
            const liveUrl = `http://${domain}`;
            // Update deployment record to LIVE
            const deployment = db_1.db.getDeployment(deployment_id);
            if (deployment) {
                deployment.container_port = allocatedPort;
                deployment.live_url = liveUrl;
                db_1.db.saveDeployment(deployment);
            }
            db_1.db.updateDeploymentStatus(deployment_id, 'live');
            db_1.db.appendDeploymentLog(deployment_id, `SUCCESS! Application is now live at ${liveUrl}`);
            // Save Route mapping to DB
            db_1.db.saveRoute({
                project_id,
                domain,
                container_port: allocatedPort,
                is_active: true,
                updated_at: new Date().toISOString()
            });
            // Stop old containers (zero-downtime transition)
            await docker_1.dockerService.stopAndRemoveOldContainers(project_id, deployment_id);
            // Perform workspace cleanup
            cleanWorkspaceDirectory(deployment_id);
            // Notify clients
            await notifier_1.notificationService.notifySuccess(deployment_id);
        }
        catch (error) {
            console.error(`[Worker] Pipeline error in phase [${currentPhase}]:`, error);
            const failedStateMap = {
                cloning: 'clone_failed',
                detecting: 'detection_failed',
                building: 'build_failed',
                starting: 'start_failed',
                health_checking: 'health_check_failed',
                updating_routing: 'routing_failed'
            };
            const finalStatus = failedStateMap[currentPhase] || 'build_failed';
            db_1.db.updateDeploymentStatus(deployment_id, finalStatus, error.message);
            // If new container was started, kill it (Rollback)
            if (newContainerStarted) {
                db_1.db.appendDeploymentLog(deployment_id, `ROLLBACK: Stopping failed container paas_${deployment_id}...`);
                try {
                    (0, child_process_1.execSync)(`docker stop paas_${deployment_id}`);
                    (0, child_process_1.execSync)(`docker rm paas_${deployment_id}`);
                    db_1.db.appendDeploymentLog(deployment_id, `ROLLBACK: Failed container cleaned up.`);
                }
                catch (cleanErr) {
                    db_1.db.appendDeploymentLog(deployment_id, `ROLLBACK WARNING: Failed to remove container: ${cleanErr.message}`);
                }
            }
            // Cleanup files
            cleanWorkspaceDirectory(deployment_id);
            // Dispatch failure notification
            await notifier_1.notificationService.notifyFailure(deployment_id, currentPhase, error.message);
        }
    }, config_1.config.MAX_CONCURRENT_BUILDS);
}
/**
 * Searches the database for currently active ports and allocates a new free port.
 */
function allocateDynamicPort(projectId) {
    const routes = db_1.db.getRoutes();
    const deployments = db_1.db.getDeployments();
    // Ports currently in use
    const activePorts = new Set();
    for (const r of routes) {
        activePorts.add(r.container_port);
    }
    for (const d of deployments) {
        if (d.status === 'live' && d.container_port) {
            activePorts.add(d.container_port);
        }
    }
    const startPort = config_1.config.PORT_RANGE.start;
    const endPort = config_1.config.PORT_RANGE.end;
    for (let port = startPort; port <= endPort; port++) {
        if (!activePorts.has(port)) {
            return port;
        }
    }
    throw new Error('No available ports left in the configured range.');
}
/**
 * Health check loops: hits the container on its allocated host port.
 */
async function performHealthCheck(deploymentId, port) {
    const url = `http://localhost:${port}/health`;
    const fallbackUrl = `http://localhost:${port}/`;
    db_1.db.appendDeploymentLog(deploymentId, `Starting health check probes on ${url}...`);
    const maxAttempts = 5;
    const intervalMs = 5000;
    const gracePeriodMs = 5000;
    // Grace period wait
    await new Promise(r => setTimeout(r, gracePeriodMs));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        db_1.db.appendDeploymentLog(deploymentId, `Probe #${attempt} to container on port ${port}...`);
        try {
            // Try health endpoint first
            let res = await fetch(url).catch(() => null);
            if (!res || !res.ok) {
                // Try fallback root endpoint
                res = await fetch(fallbackUrl);
            }
            if (res.ok) {
                db_1.db.appendDeploymentLog(deploymentId, `Health check passed! Status: ${res.status}`);
                return;
            }
            else {
                db_1.db.appendDeploymentLog(deploymentId, `Probe #${attempt} failed with HTTP status: ${res.status}`);
            }
        }
        catch (err) {
            db_1.db.appendDeploymentLog(deploymentId, `Probe #${attempt} connection refused: ${err.message}`);
        }
        if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, intervalMs));
        }
    }
    throw new Error(`Health check failed after ${maxAttempts} attempts. Container is unresponsive.`);
}
/**
 * Cleans build workspace source files to conserve disk space.
 */
function cleanWorkspaceDirectory(deploymentId) {
    try {
        const deployDir = path.join(config_1.config.BUILDS_DIR, deploymentId);
        if (fs.existsSync(deployDir)) {
            const sourceDir = path.join(deployDir, 'source');
            const dockerDir = path.join(deployDir, 'docker');
            if (fs.existsSync(sourceDir)) {
                fs.rmSync(sourceDir, { recursive: true, force: true });
            }
            if (fs.existsSync(dockerDir)) {
                fs.rmSync(dockerDir, { recursive: true, force: true });
            }
            // Leave logs directory intact for historical lookup
        }
    }
    catch (err) {
        console.error(`Failed to clean workspace directory: ${err.message}`);
    }
}
