import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db';
import { config } from '../config';

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
    try {
      const containerName = `paas_${deploymentId}`;
      const logs = execSync(`docker logs ${containerName} --tail ${limit}`).toString();
      return logs;
    } catch (error: any) {
      return `Failed to fetch logs: ${error.message}`;
    }
  }
}

export const dockerService = new DockerService();
