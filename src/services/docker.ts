import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db';
import { config } from '../config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// Keep track of simulated servers (active mock containers) in memory
const simulatedContainers = new Map<string, {
  server: any;
  port: number;
  projectId: string;
  deploymentId: string;
  logs: string[];
}>();

export class DockerService {
  /**
   * Builds the Docker image.
   */
  async build(
    projectId: string,
    commitSha: string,
    deploymentId: string,
    sourceDir: string,
    dockerfilePath: string
  ): Promise<string> {
    const commitShaShort = commitSha.substring(0, 7);
    const imageName = `paas/${projectId}:${commitShaShort}`;
    const latestImageName = `paas/${projectId}:latest`;

    db.appendDeploymentLog(deploymentId, `Preparing Docker image build [${imageName}]...`);

    if (config.SIMULATION_MODE) {
      return this.simulateBuild(deploymentId, projectId, commitShaShort);
    }

    return new Promise((resolve, reject) => {
      // docker build command
      const buildArgs = [
        'build',
        '--file', dockerfilePath,
        '--tag', imageName,
        '--tag', latestImageName,
        '--label', `paas.deployment_id=${deploymentId}`,
        '--label', `paas.project_id=${projectId}`,
        '--label', `paas.commit_sha=${commitSha}`,
        '--no-cache',
        sourceDir
      ];

      db.appendDeploymentLog(deploymentId, `docker ${buildArgs.join(' ')}`);

      const buildProcess = spawn('docker', buildArgs);
      const buildLogFile = path.join(config.BUILDS_DIR, deploymentId, 'logs/build.log');
      const logStream = fs.createWriteStream(buildLogFile);

      buildProcess.stdout.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          db.appendDeploymentLog(deploymentId, `[docker-build] ${line}`);
          logStream.write(data);
        }
      });

      buildProcess.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          db.appendDeploymentLog(deploymentId, `[docker-build-stderr] ${line}`);
          logStream.write(data);
        }
      });

      buildProcess.on('close', (code) => {
        logStream.end();
        if (code === 0) {
          db.appendDeploymentLog(deploymentId, `Docker image built successfully: ${imageName}`);
          resolve(imageName);
        } else {
          db.appendDeploymentLog(deploymentId, `Docker build failed with exit code ${code}`);
          reject(new Error(`Docker build failed with code ${code}`));
        }
      });

      buildProcess.on('error', (err) => {
        db.appendDeploymentLog(deploymentId, `Failed to spawn docker command: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Runs the Docker container.
   */
  async run(
    projectId: string,
    deploymentId: string,
    commitSha: string,
    allocatedPort: number,
    internalPort: number,
    envVars: Record<string, string>
  ): Promise<string> {
    const commitShaShort = commitSha.substring(0, 7);
    const imageName = `paas/${projectId}:${commitShaShort}`;
    const containerName = `paas_${deploymentId}`;

    db.appendDeploymentLog(deploymentId, `Launching container [${containerName}] on port ${allocatedPort}...`);

    if (config.SIMULATION_MODE) {
      return this.simulateRun(projectId, deploymentId, commitShaShort, allocatedPort, internalPort, envVars);
    }

    // 1. Create temporary env-file for docker run
    const runtimeEnvDir = path.join(config.BUILDS_DIR, deploymentId, 'docker');
    fs.mkdirSync(runtimeEnvDir, { recursive: true });
    const runtimeEnvPath = path.join(runtimeEnvDir, 'runtime.env');

    let envContent = '';
    for (const [key, val] of Object.entries(envVars)) {
      envContent += `${key}=${val}\n`;
    }
    fs.writeFileSync(runtimeEnvPath, envContent, { mode: 0o600 });
    db.appendDeploymentLog(deploymentId, `Injected decrypted environment variables.`);

    return new Promise((resolve, reject) => {
      // 2. Build docker run args
      const runArgs = [
        'run',
        '--detach',
        '--name', containerName,
        '--publish', `${allocatedPort}:${internalPort}`,
        '--env-file', runtimeEnvPath,
        '--label', `paas.deployment_id=${deploymentId}`,
        '--label', `paas.project_id=${projectId}`,
        '--restart', 'unless-stopped',
        imageName
      ];

      db.appendDeploymentLog(deploymentId, `docker ${runArgs.join(' ')}`);

      const runProcess = spawn('docker', runArgs);
      let containerId = '';

      runProcess.stdout.on('data', (data) => {
        containerId += data.toString().trim();
      });

      runProcess.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          db.appendDeploymentLog(deploymentId, `[docker-run-err] ${line}`);
        }
      });

      runProcess.on('close', (code) => {
        // Cleanup temp file
        if (fs.existsSync(runtimeEnvPath)) {
          fs.unlinkSync(runtimeEnvPath);
        }

        if (code === 0) {
          const finalId = containerId.substring(0, 12);
          db.appendDeploymentLog(deploymentId, `Container started successfully. ID: ${finalId}`);
          resolve(finalId);
        } else {
          db.appendDeploymentLog(deploymentId, `Container failed to start (exit code ${code})`);
          reject(new Error(`Docker run failed with code ${code}`));
        }
      });

      runProcess.on('error', (err) => {
        if (fs.existsSync(runtimeEnvPath)) fs.unlinkSync(runtimeEnvPath);
        db.appendDeploymentLog(deploymentId, `Failed to spawn docker run command: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Stops and removes old containers running for this project.
   */
  async stopAndRemoveOldContainers(projectId: string, currentDeploymentId: string): Promise<void> {
    const activeDeployment = db.getDeployment(currentDeploymentId);
    
    if (config.SIMULATION_MODE) {
      // Close active mock server instances for this project except currentDeploymentId
      for (const [depId, container] of simulatedContainers.entries()) {
        if (container.projectId === projectId && depId !== currentDeploymentId) {
          activeDeployment && db.appendDeploymentLog(currentDeploymentId, `[SIMULATION] Stopping old container server for deployment: ${depId}`);
          container.server.close();
          simulatedContainers.delete(depId);
        }
      }
      return;
    }

    try {
      // Find old containers
      const filterLabel = `paas.project_id=${projectId}`;
      const formatString = '{{.ID}}';
      const findCmd = `docker ps --filter "label=${filterLabel}" --format "${formatString}"`;
      
      const stdout = execSync(findCmd).toString().trim();
      if (!stdout) {
        activeDeployment && db.appendDeploymentLog(currentDeploymentId, `No previous active containers found.`);
        return;
      }

      const containerIds = stdout.split('\n').map(id => id.trim()).filter(Boolean);
      const currentContainerName = `paas_${currentDeploymentId}`;

      for (const id of containerIds) {
        // Get inspect name to avoid killing the newly started container
        const nameCmd = `docker inspect --format "{{.Name}}" ${id}`;
        const name = execSync(nameCmd).toString().trim().replace('/', '');
        
        if (name !== currentContainerName) {
          activeDeployment && db.appendDeploymentLog(currentDeploymentId, `Stopping old container ${name} (${id})...`);
          execSync(`docker stop ${id}`);
          execSync(`docker rm ${id}`);
          activeDeployment && db.appendDeploymentLog(currentDeploymentId, `Old container ${name} removed.`);
        }
      }
    } catch (error: any) {
      activeDeployment && db.appendDeploymentLog(currentDeploymentId, `Warning during old container cleanup: ${error.message}`);
    }
  }

  /**
   * Retrieves container logs.
   */
  async getLogs(deploymentId: string, limit = 100): Promise<string> {
    if (config.SIMULATION_MODE) {
      const container = simulatedContainers.get(deploymentId);
      return container ? container.logs.slice(-limit).join('\n') : 'Container not found or offline.';
    }

    try {
      const containerName = `paas_${deploymentId}`;
      const logs = execSync(`docker logs ${containerName} --tail ${limit}`).toString();
      return logs;
    } catch (error: any) {
      return `Failed to fetch logs: ${error.message}`;
    }
  }

  // --- Simulation Helpers ---

  private simulateBuild(deploymentId: string, projectId: string, commitShaShort: string): Promise<string> {
    return new Promise((resolve) => {
      const steps = [
        `Step 1/9 : FROM node:20-alpine`,
        ` ---> pulling layer: sha256:72db5db78f0a...`,
        ` ---> pulling layer: sha256:4d60d3fc106d...`,
        ` ---> download complete.`,
        `Step 2/9 : WORKDIR /app`,
        `Step 3/9 : COPY package*.json ./`,
        `Step 4/9 : RUN npm ci`,
        ` [npm] info run react-vite-app@1.0.0 prepare`,
        ` [npm] added 120 packages in 3.124s`,
        `Step 5/9 : COPY . .`,
        `Step 6/9 : RUN npm run build`,
        ` > react-vite-app@1.0.0 build`,
        ` > vite build`,
        ` vite v5.2.0 building for production...`,
        ` transforming...`,
        ` ✓ 48 modules transformed.`,
        ` dist/index.html                  0.48 kB │ gzip: 0.28 kB`,
        ` dist/assets/index-D783b2a.js   143.20 kB │ gzip: 46.10 kB`,
        ` dist/assets/index-C883d1c.css   24.12 kB │ gzip:  5.40 kB`,
        ` ✓ built in 1.45s`,
        `Step 7/9 : FROM nginx:alpine`,
        `Step 8/9 : COPY --from=builder /app/dist /usr/share/nginx/html`,
        `Step 9/9 : EXPOSE 80`,
        `Successfully built sha256:9234857dddf1272...`,
        `Successfully tagged paas/${projectId}:${commitShaShort}`,
        `Successfully tagged paas/${projectId}:latest`
      ];

      let idx = 0;
      const interval = setInterval(() => {
        if (idx < steps.length) {
          db.appendDeploymentLog(deploymentId, `[SIMULATION-docker] ${steps[idx]}`);
          idx++;
        } else {
          clearInterval(interval);
          resolve(`paas/${projectId}:${commitShaShort}`);
        }
      }, 250);
    });
  }

  private simulateRun(
    projectId: string,
    deploymentId: string,
    commitShaShort: string,
    allocatedPort: number,
    internalPort: number,
    envVars: Record<string, string>
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const project = db.getProject(projectId);
        const projectName = project ? project.name : 'Unknown Application';
        const repoName = project ? project.repo_full_name : 'unknown/repo';

        db.appendDeploymentLog(deploymentId, `[SIMULATION] Creating dynamic mock server for ${projectName} on port ${allocatedPort}...`);

        // Spin up a mock Hono instance to behave like the deployed app!
        const app = new Hono();
        
        // Setup simple HTML page that looks like the deployed web app
        app.get('/', (c) => {
          return c.html(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>${projectName} - Live Deployment</title>
              <style>
                body {
                  font-family: 'Inter', system-ui, sans-serif;
                  background: linear-gradient(135deg, #0f172a, #1e1b4b);
                  color: #f8fafc;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  min-height: 100vh;
                  margin: 0;
                  padding: 20px;
                  box-sizing: border-box;
                }
                .card {
                  background: rgba(30, 41, 59, 0.7);
                  backdrop-filter: blur(10px);
                  border: 1px solid rgba(255, 255, 255, 0.1);
                  border-radius: 20px;
                  padding: 40px;
                  max-width: 600px;
                  width: 100%;
                  box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.5);
                  text-align: center;
                }
                .badge {
                  background: #10b981;
                  color: #fff;
                  padding: 6px 14px;
                  border-radius: 9999px;
                  font-weight: 600;
                  font-size: 14px;
                  display: inline-block;
                  margin-bottom: 20px;
                  letter-spacing: 0.05em;
                }
                h1 {
                  font-size: 2.5rem;
                  margin: 0 0 10px 0;
                  background: linear-gradient(to right, #38bdf8, #818cf8);
                  -webkit-background-clip: text;
                  -webkit-text-fill-color: transparent;
                }
                p.desc {
                  color: #94a3b8;
                  font-size: 1.1rem;
                  margin: 0 0 30px 0;
                }
                .meta-grid {
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 15px;
                  text-align: left;
                  background: rgba(15, 23, 42, 0.4);
                  padding: 20px;
                  border-radius: 12px;
                  border: 1px solid rgba(255, 255, 255, 0.05);
                  font-size: 14px;
                  margin-bottom: 30px;
                }
                .meta-label {
                  color: #64748b;
                  font-weight: 500;
                }
                .meta-value {
                  color: #e2e8f0;
                  font-family: monospace;
                  word-break: break-all;
                }
                .env-section {
                  text-align: left;
                }
                .env-title {
                  font-size: 16px;
                  color: #cbd5e1;
                  margin-bottom: 10px;
                  font-weight: 600;
                }
                .env-list {
                  background: rgba(0, 0, 0, 0.2);
                  padding: 15px;
                  border-radius: 8px;
                  font-family: monospace;
                  font-size: 12px;
                  color: #a7f3d0;
                  max-height: 150px;
                  overflow-y: auto;
                  margin: 0;
                }
                .footer {
                  margin-top: 30px;
                  font-size: 12px;
                  color: #475569;
                }
              </style>
            </head>
            <body>
              <div class="card">
                <span class="badge">ACTIVE DEPLOYMENT</span>
                <h1>${projectName}</h1>
                <p class="desc">Repository: ${repoName}</p>
                
                <div class="meta-grid">
                  <div class="meta-label">Deployment ID</div>
                  <div class="meta-value">${deploymentId}</div>
                  <div class="meta-label">Commit SHA</div>
                  <div class="meta-value">${commitShaShort}</div>
                  <div class="meta-label">Internal Port</div>
                  <div class="meta-value">${internalPort || 80}</div>
                  <div class="meta-label">Host Port</div>
                  <div class="meta-value">${allocatedPort}</div>
                </div>

                <div class="env-section">
                  <div class="env-title">Injected Environment Variables</div>
                  <pre class="env-list">${
                    Object.entries(envVars)
                      .map(([k, v]) => `${k}=${v.substring(0, 5)}${v.length > 5 ? '...' : ''}`)
                      .join('\n') || 'None'
                  }</pre>
                </div>

                <div class="footer">
                  Copyright &copy; 2026 Perdafos. All rights reserved.
                </div>
              </div>
            </body>
            </html>
          `);
        });

        // Health check endpoint
        app.get('/health', (c) => {
          return c.json({ status: 'OK', framework: project?.name, deploymentId });
        });

        // Start listening
        const server = serve({
          fetch: app.fetch,
          port: allocatedPort
        });

        // Store active container details
        const mockLogs = [
          `[Server] Starting application ${projectName}...`,
          `[Server] Loading configurations...`,
          `[Server] Environment: PRODUCTION`,
          `[Server] Ports initialized. Node version v20.10.0`,
          `[Server] Database connection successful.`,
          `[Server] App started. Listening on port ${allocatedPort}...`,
          `[Server] Ready to accept requests.`
        ];

        simulatedContainers.set(deploymentId, {
          server,
          port: allocatedPort,
          projectId,
          deploymentId,
          logs: mockLogs
        });

        db.appendDeploymentLog(deploymentId, `[SIMULATION] Mock container mock-started on port ${allocatedPort}.`);
        resolve(`sim_container_${deploymentId}`);
      } catch (err: any) {
        db.appendDeploymentLog(deploymentId, `[SIMULATION] Failed to spin up mock container: ${err.message}`);
        reject(err);
      }
    });
  }
}

export const dockerService = new DockerService();
