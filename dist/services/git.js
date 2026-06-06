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
exports.gitService = exports.GitService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const db_1 = require("../db");
const config_1 = require("../config");
class GitService {
    /**
     * Clones a repository to a deployment workspace.
     */
    async clone(deploymentId, repoUrl, branch, isPrivate, sshKeyRef) {
        const deployDir = path.join(config_1.config.BUILDS_DIR, deploymentId);
        const sourceDir = path.join(deployDir, 'source');
        const dockerDir = path.join(deployDir, 'docker');
        const logsDir = path.join(deployDir, 'logs');
        // Create directories
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.mkdirSync(dockerDir, { recursive: true });
        fs.mkdirSync(logsDir, { recursive: true });
        db_1.db.appendDeploymentLog(deploymentId, `Preparing isolated environment at ${sourceDir}`);
        return new Promise((resolve, reject) => {
            db_1.db.appendDeploymentLog(deploymentId, `Initiating git clone for branch [${branch}]...`);
            let tempKeyPath = '';
            let tempConfigPath = '';
            const env = { ...process.env };
            if (isPrivate && sshKeyRef) {
                db_1.db.appendDeploymentLog(deploymentId, `Fetching SSH Deploy Key from vault (ref: ${sshKeyRef})...`);
                try {
                    const project = db_1.db.getProjects().find(p => p.id === db_1.db.getDeployment(deploymentId)?.project_id);
                    // Standard SSH setup
                    const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----\n${sshKeyRef}\n-----END OPENSSH PRIVATE KEY-----`;
                    tempKeyPath = path.join(process.cwd(), `data/temp_ssh_${deploymentId}`);
                    tempConfigPath = path.join(process.cwd(), `data/temp_ssh_config_${deploymentId}`);
                    fs.writeFileSync(tempKeyPath, privateKey, { mode: 0o600 });
                    const sshConfig = `Host github.com\n  IdentityFile ${tempKeyPath}\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n`;
                    fs.writeFileSync(tempConfigPath, sshConfig);
                    env.GIT_SSH_COMMAND = `ssh -F ${tempConfigPath}`;
                    db_1.db.appendDeploymentLog(deploymentId, `Configured SSH agent with key isolation.`);
                }
                catch (err) {
                    db_1.db.appendDeploymentLog(deploymentId, `Failed to configure SSH credentials: ${err.message}`);
                    return reject(err);
                }
            }
            // Spawn git clone command
            const gitArgs = [
                'clone',
                '--depth', '1',
                '--branch', branch,
                '--single-branch',
                repoUrl,
                sourceDir
            ];
            db_1.db.appendDeploymentLog(deploymentId, `git ${gitArgs.join(' ')}`);
            const gitProcess = (0, child_process_1.spawn)('git', gitArgs, { env });
            const logStream = fs.createWriteStream(path.join(logsDir, 'clone.log'));
            gitProcess.stdout.on('data', (data) => {
                const line = data.toString().trim();
                if (line) {
                    db_1.db.appendDeploymentLog(deploymentId, `[git] ${line}`);
                    logStream.write(data);
                }
            });
            gitProcess.stderr.on('data', (data) => {
                const line = data.toString().trim();
                if (line) {
                    db_1.db.appendDeploymentLog(deploymentId, `[git-err] ${line}`);
                    logStream.write(data);
                }
            });
            gitProcess.on('close', (code) => {
                logStream.end();
                // Clean up credentials
                if (tempKeyPath && fs.existsSync(tempKeyPath)) {
                    fs.unlinkSync(tempKeyPath);
                }
                if (tempConfigPath && fs.existsSync(tempConfigPath)) {
                    fs.unlinkSync(tempConfigPath);
                }
                if (code === 0) {
                    db_1.db.appendDeploymentLog(deploymentId, `Git clone completed successfully.`);
                    resolve(sourceDir);
                }
                else {
                    db_1.db.appendDeploymentLog(deploymentId, `Git clone failed with exit code ${code}`);
                    reject(new Error(`Git clone failed with code ${code}`));
                }
            });
            gitProcess.on('error', (err) => {
                if (tempKeyPath && fs.existsSync(tempKeyPath))
                    fs.unlinkSync(tempKeyPath);
                if (tempConfigPath && fs.existsSync(tempConfigPath))
                    fs.unlinkSync(tempConfigPath);
                db_1.db.appendDeploymentLog(deploymentId, `Failed to spawn git command: ${err.message}`);
                reject(err);
            });
        });
    }
}
exports.GitService = GitService;
exports.gitService = new GitService();
