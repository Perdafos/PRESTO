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
exports.dockerService = exports.DockerService = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const db_1 = require("../db");
const config_1 = require("../config");
class DockerService {
    /**
     * Builds the Docker image.
     */
    async build(projectId, commitSha, deploymentId, sourceDir, dockerfilePath) {
        const commitShaShort = commitSha.substring(0, 7);
        const imageName = `paas/${projectId}:${commitShaShort}`;
        const latestImageName = `paas/${projectId}:latest`;
        db_1.db.appendDeploymentLog(deploymentId, `Preparing Docker image build [${imageName}]...`);
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
            db_1.db.appendDeploymentLog(deploymentId, `docker ${buildArgs.join(' ')}`);
            const buildProcess = (0, child_process_1.spawn)('docker', buildArgs);
            const buildLogFile = path.join(config_1.config.BUILDS_DIR, deploymentId, 'logs/build.log');
            const logStream = fs.createWriteStream(buildLogFile);
            buildProcess.stdout.on('data', (data) => {
                const line = data.toString().trim();
                if (line) {
                    db_1.db.appendDeploymentLog(deploymentId, `[docker-build] ${line}`);
                    logStream.write(data);
                }
            });
            buildProcess.stderr.on('data', (data) => {
                const line = data.toString().trim();
                if (line) {
                    db_1.db.appendDeploymentLog(deploymentId, `[docker-build-stderr] ${line}`);
                    logStream.write(data);
                }
            });
            buildProcess.on('close', (code) => {
                logStream.end();
                if (code === 0) {
                    db_1.db.appendDeploymentLog(deploymentId, `Docker image built successfully: ${imageName}`);
                    resolve(imageName);
                }
                else {
                    db_1.db.appendDeploymentLog(deploymentId, `Docker build failed with exit code ${code}`);
                    reject(new Error(`Docker build failed with code ${code}`));
                }
            });
            buildProcess.on('error', (err) => {
                db_1.db.appendDeploymentLog(deploymentId, `Failed to spawn docker command: ${err.message}`);
                reject(err);
            });
        });
    }
    /**
     * Runs the Docker container.
     */
    async run(projectId, deploymentId, commitSha, allocatedPort, internalPort, envVars) {
        const commitShaShort = commitSha.substring(0, 7);
        const imageName = `paas/${projectId}:${commitShaShort}`;
        const containerName = `paas_${deploymentId}`;
        db_1.db.appendDeploymentLog(deploymentId, `Launching container [${containerName}] on port ${allocatedPort}...`);
        // 1. Create temporary env-file for docker run
        const runtimeEnvDir = path.join(config_1.config.BUILDS_DIR, deploymentId, 'docker');
        fs.mkdirSync(runtimeEnvDir, { recursive: true });
        const runtimeEnvPath = path.join(runtimeEnvDir, 'runtime.env');
        let envContent = '';
        for (const [key, val] of Object.entries(envVars)) {
            envContent += `${key}=${val}\n`;
        }
        fs.writeFileSync(runtimeEnvPath, envContent, { mode: 0o600 });
        db_1.db.appendDeploymentLog(deploymentId, `Injected decrypted environment variables.`);
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
            db_1.db.appendDeploymentLog(deploymentId, `docker ${runArgs.join(' ')}`);
            const runProcess = (0, child_process_1.spawn)('docker', runArgs);
            let containerId = '';
            runProcess.stdout.on('data', (data) => {
                containerId += data.toString().trim();
            });
            runProcess.stderr.on('data', (data) => {
                const line = data.toString().trim();
                if (line) {
                    db_1.db.appendDeploymentLog(deploymentId, `[docker-run-err] ${line}`);
                }
            });
            runProcess.on('close', (code) => {
                // Cleanup temp file
                if (fs.existsSync(runtimeEnvPath)) {
                    fs.unlinkSync(runtimeEnvPath);
                }
                if (code === 0) {
                    const finalId = containerId.substring(0, 12);
                    db_1.db.appendDeploymentLog(deploymentId, `Container started successfully. ID: ${finalId}`);
                    resolve(finalId);
                }
                else {
                    db_1.db.appendDeploymentLog(deploymentId, `Container failed to start (exit code ${code})`);
                    reject(new Error(`Docker run failed with code ${code}`));
                }
            });
            runProcess.on('error', (err) => {
                if (fs.existsSync(runtimeEnvPath))
                    fs.unlinkSync(runtimeEnvPath);
                db_1.db.appendDeploymentLog(deploymentId, `Failed to spawn docker run command: ${err.message}`);
                reject(err);
            });
        });
    }
    /**
     * Stops and removes old containers running for this project.
     */
    async stopAndRemoveOldContainers(projectId, currentDeploymentId) {
        const activeDeployment = db_1.db.getDeployment(currentDeploymentId);
        try {
            // Find old containers
            const filterLabel = `paas.project_id=${projectId}`;
            const formatString = '{{.ID}}';
            const findCmd = `docker ps --filter "label=${filterLabel}" --format "${formatString}"`;
            const stdout = (0, child_process_1.execSync)(findCmd).toString().trim();
            if (!stdout) {
                activeDeployment && db_1.db.appendDeploymentLog(currentDeploymentId, `No previous active containers found.`);
                return;
            }
            const containerIds = stdout.split('\n').map(id => id.trim()).filter(Boolean);
            const currentContainerName = `paas_${currentDeploymentId}`;
            for (const id of containerIds) {
                // Get inspect name to avoid killing the newly started container
                const nameCmd = `docker inspect --format "{{.Name}}" ${id}`;
                const name = (0, child_process_1.execSync)(nameCmd).toString().trim().replace('/', '');
                if (name !== currentContainerName) {
                    activeDeployment && db_1.db.appendDeploymentLog(currentDeploymentId, `Stopping old container ${name} (${id})...`);
                    (0, child_process_1.execSync)(`docker stop ${id}`);
                    (0, child_process_1.execSync)(`docker rm ${id}`);
                    activeDeployment && db_1.db.appendDeploymentLog(currentDeploymentId, `Old container ${name} removed.`);
                }
            }
        }
        catch (error) {
            activeDeployment && db_1.db.appendDeploymentLog(currentDeploymentId, `Warning during old container cleanup: ${error.message}`);
        }
    }
    /**
     * Retrieves container logs.
     */
    async getLogs(deploymentId, limit = 100) {
        try {
            const containerName = `paas_${deploymentId}`;
            const logs = (0, child_process_1.execSync)(`docker logs ${containerName} --tail ${limit}`).toString();
            return logs;
        }
        catch (error) {
            return `Failed to fetch logs: ${error.message}`;
        }
    }
}
exports.DockerService = DockerService;
exports.dockerService = new DockerService();
