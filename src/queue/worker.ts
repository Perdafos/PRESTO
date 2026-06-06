import { queue } from './index';
import { Job } from './queue.interface';
import { db, DeploymentStatus } from '../db';
import { gitService } from '../services/git';
import { detectorService } from '../services/detector';
import { dockerService } from '../services/docker';
import { nginxService } from '../services/nginx';
import { decrypt } from '../services/crypto';
import { notificationService } from '../services/notifier';
import { config } from '../config';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

interface BuildJobPayload {
  deployment_id: string;
  project_id: string;
  repo_full_name: string;
  repo_clone_url: string;
  is_private: boolean;
  commit_sha: string;
  commit_message: string;
  deployment_branch: string;
  domain: string;
  env_vars_encrypted: string;
  ssh_key_ref?: string;
}

export function startWorker() {
  console.log('[Worker] Starting background worker listener...');
  
  queue.processJobs(async (job: Job<BuildJobPayload>) => {
    const payload = job.data;
    const { deployment_id, project_id, domain, is_private, ssh_key_ref } = payload;

    console.log(`[Worker] Processing deployment job: ${deployment_id} for project ${project_id}`);
    
    let currentPhase: DeploymentStatus = 'queued';
    let allocatedPort = 0;
    let newContainerStarted = false;

    try {
      // --- Capacity Checks ---
      currentPhase = 'queued';
      const freeMemGb = os.freemem() / (1024 * 1024 * 1024);
      const loadAvg = os.loadavg();
      
      db.appendDeploymentLog(deployment_id, `System load average: ${loadAvg[0].toFixed(2)}. Free memory: ${freeMemGb.toFixed(2)} GB.`);
      
      if (freeMemGb < 0.5) {
        db.appendDeploymentLog(deployment_id, `WARNING: Low system memory (${freeMemGb.toFixed(2)} GB free). Proceeding with caution.`);
      }

      // --- Phase 1: Git Clone ---
      currentPhase = 'cloning';
      db.updateDeploymentStatus(deployment_id, 'cloning');
      const sourceDir = await gitService.clone(
        deployment_id,
        payload.repo_clone_url,
        payload.deployment_branch,
        is_private,
        ssh_key_ref
      );

      // --- Phase 2: Framework Detection ---
      currentPhase = 'detecting';
      db.updateDeploymentStatus(deployment_id, 'detecting');
      const detectResult = await detectorService.detect(deployment_id, sourceDir);

      // --- Phase 3: Docker Build ---
      currentPhase = 'building';
      db.updateDeploymentStatus(deployment_id, 'building');
      
      const dockerfilePath = path.join(config.BUILDS_DIR, deployment_id, 'docker/Dockerfile');
      await dockerService.build(
        project_id,
        payload.commit_sha,
        deployment_id,
        sourceDir,
        dockerfilePath
      );

      // --- Phase 4: Prepare & Allocate Port ---
      currentPhase = 'starting';
      db.updateDeploymentStatus(deployment_id, 'starting');
      
      // 1. Allocate dynamic port
      allocatedPort = allocateDynamicPort(project_id);
      db.appendDeploymentLog(deployment_id, `Allocated host port: ${allocatedPort}`);

      // 2. Decrypt environment variables
      let envVars: Record<string, string> = {};
      if (payload.env_vars_encrypted) {
        db.appendDeploymentLog(deployment_id, `Decrypting environment variables...`);
        try {
          const decryptedJson = decrypt(payload.env_vars_encrypted, config.ENCRYPTION_KEY);
          envVars = JSON.parse(decryptedJson);
        } catch (err: any) {
          throw new Error(`Environment variables decryption failed: ${err.message}`);
        }
      }

      // Add auto-injected system envs
      envVars['APP_ENV'] = 'production';
      envVars['PORT'] = detectResult.internalPort.toString();
      envVars['PLATFORM_DEPLOYMENT_ID'] = deployment_id;

      // 3. Start the container
      await dockerService.run(
        project_id,
        deployment_id,
        payload.commit_sha,
        allocatedPort,
        detectResult.internalPort,
        envVars
      );
      newContainerStarted = true;

      // --- Phase 5: Health Checking ---
      currentPhase = 'health_checking';
      db.updateDeploymentStatus(deployment_id, 'health_checking');
      await performHealthCheck(deployment_id, allocatedPort);

      // --- Phase 6: Dynamic Routing Configuration ---
      currentPhase = 'updating_routing';
      db.updateDeploymentStatus(deployment_id, 'updating_routing');
      await nginxService.upsertRoute(project_id, deployment_id, domain, allocatedPort);

      // --- Phase 7: Live & Cleanup ---
      currentPhase = 'live';
      const liveUrl = `http://${domain}`;

      // Update deployment record to LIVE
      const deployment = db.getDeployment(deployment_id);
      if (deployment) {
        deployment.container_port = allocatedPort;
        deployment.live_url = liveUrl;
        db.saveDeployment(deployment);
      }
      db.updateDeploymentStatus(deployment_id, 'live');
      db.appendDeploymentLog(deployment_id, `SUCCESS! Application is now live at ${liveUrl}`);

      // Save Route mapping to DB
      db.saveRoute({
        project_id,
        domain,
        container_port: allocatedPort,
        is_active: true,
        updated_at: new Date().toISOString()
      });

      // Stop old containers (zero-downtime transition)
      await dockerService.stopAndRemoveOldContainers(project_id, deployment_id);

      // Perform workspace cleanup
      cleanWorkspaceDirectory(deployment_id);

      // Notify clients
      await notificationService.notifySuccess(deployment_id);

    } catch (error: any) {
      console.error(`[Worker] Pipeline error in phase [${currentPhase}]:`, error);
      
      const failedStateMap: Record<string, DeploymentStatus> = {
        cloning: 'clone_failed',
        detecting: 'detection_failed',
        building: 'build_failed',
        starting: 'start_failed',
        health_checking: 'health_check_failed',
        updating_routing: 'routing_failed'
      };

      const finalStatus = failedStateMap[currentPhase] || 'build_failed';
      db.updateDeploymentStatus(deployment_id, finalStatus, error.message);

      // If new container was started, kill it (Rollback)
      if (newContainerStarted) {
        db.appendDeploymentLog(deployment_id, `ROLLBACK: Stopping failed container paas_${deployment_id}...`);
        try {
          execSync(`docker stop paas_${deployment_id}`);
          execSync(`docker rm paas_${deployment_id}`);
          db.appendDeploymentLog(deployment_id, `ROLLBACK: Failed container cleaned up.`);
        } catch (cleanErr: any) {
          db.appendDeploymentLog(deployment_id, `ROLLBACK WARNING: Failed to remove container: ${cleanErr.message}`);
        }
      }

      // Cleanup files
      cleanWorkspaceDirectory(deployment_id);

      // Dispatch failure notification
      await notificationService.notifyFailure(deployment_id, currentPhase, error.message);
    }
  }, config.MAX_CONCURRENT_BUILDS);
}

/**
 * Searches the database for currently active ports and allocates a new free port.
 */
function allocateDynamicPort(projectId: string): number {
  const routes = db.getRoutes();
  const deployments = db.getDeployments();

  // Ports currently in use
  const activePorts = new Set<number>();
  for (const r of routes) {
    activePorts.add(r.container_port);
  }
  for (const d of deployments) {
    if (d.status === 'live' && d.container_port) {
      activePorts.add(d.container_port);
    }
  }

  const startPort = config.PORT_RANGE.start;
  const endPort = config.PORT_RANGE.end;

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
async function performHealthCheck(deploymentId: string, port: number): Promise<void> {
  const url = `http://localhost:${port}/health`;
  const fallbackUrl = `http://localhost:${port}/`;
  
  db.appendDeploymentLog(deploymentId, `Starting health check probes on ${url}...`);

  const maxAttempts = 5;
  const intervalMs = 5000;
  const gracePeriodMs = 5000;

  // Grace period wait
  await new Promise(r => setTimeout(r, gracePeriodMs));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    db.appendDeploymentLog(deploymentId, `Probe #${attempt} to container on port ${port}...`);
    try {
      // Try health endpoint first
      let res = await fetch(url).catch(() => null);
      if (!res || !res.ok) {
        // Try fallback root endpoint
        res = await fetch(fallbackUrl);
      }

      if (res.ok) {
        db.appendDeploymentLog(deploymentId, `Health check passed! Status: ${res.status}`);
        return;
      } else {
        db.appendDeploymentLog(deploymentId, `Probe #${attempt} failed with HTTP status: ${res.status}`);
      }
    } catch (err: any) {
      db.appendDeploymentLog(deploymentId, `Probe #${attempt} connection refused: ${err.message}`);
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
function cleanWorkspaceDirectory(deploymentId: string) {
  try {
    const deployDir = path.join(config.BUILDS_DIR, deploymentId);
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
  } catch (err: any) {
    console.error(`Failed to clean workspace directory: ${err.message}`);
  }
}
