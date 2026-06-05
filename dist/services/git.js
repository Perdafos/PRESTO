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
     * If in simulation mode, it simulates cloning and writes mock files.
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
        if (config_1.config.SIMULATION_MODE) {
            return this.simulateClone(deploymentId, repoUrl, branch, sourceDir);
        }
        return new Promise((resolve, reject) => {
            db_1.db.appendDeploymentLog(deploymentId, `Initiating git clone for branch [${branch}]...`);
            let tempKeyPath = '';
            let tempConfigPath = '';
            const env = { ...process.env };
            if (isPrivate && sshKeyRef) {
                db_1.db.appendDeploymentLog(deploymentId, `Fetching SSH Deploy Key from vault (ref: ${sshKeyRef})...`);
                try {
                    // In real setup, decrypt SSH key from DB / Vault.
                    // For now, look up a mock key or decrypt the mock SSH key.
                    const project = db_1.db.getProjects().find(p => p.id === db_1.db.getDeployment(deploymentId)?.project_id);
                    // Simple mock SSH key contents
                    const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----\nMOCKKEY...\n-----END OPENSSH PRIVATE KEY-----`;
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
    async simulateClone(deploymentId, repoUrl, branch, sourceDir) {
        return new Promise((resolve) => {
            db_1.db.appendDeploymentLog(deploymentId, `[SIMULATION] Starting mock git clone...`);
            const steps = [
                'Connecting to github.com...',
                'Checking authorization keys...',
                'Cloning remote repository structure...',
                'Receiving objects: 100% (45/45), done.',
                'Resolving deltas: 100% (12/12), done.'
            ];
            let stepIdx = 0;
            const interval = setInterval(() => {
                if (stepIdx < steps.length) {
                    db_1.db.appendDeploymentLog(deploymentId, `[SIMULATION-git] ${steps[stepIdx]}`);
                    stepIdx++;
                }
                else {
                    clearInterval(interval);
                    db_1.db.appendDeploymentLog(deploymentId, `[SIMULATION] Mock clone complete.`);
                    // Determine which mock files to write based on the repository name or project name
                    const deployment = db_1.db.getDeployment(deploymentId);
                    const project = deployment ? db_1.db.getProject(deployment.project_id) : null;
                    const projectName = (project?.name || '').toLowerCase();
                    // Write template structures
                    if (projectName.includes('laravel')) {
                        this.writeMockLaravelApp(sourceDir);
                        db_1.db.appendDeploymentLog(deploymentId, `[SIMULATION] Seeded workspace with Laravel project template.`);
                    }
                    else if (projectName.includes('next')) {
                        this.writeMockNextApp(sourceDir);
                        db_1.db.appendDeploymentLog(deploymentId, `[SIMULATION] Seeded workspace with Next.js project template.`);
                    }
                    else {
                        // Default to React
                        this.writeMockReactApp(sourceDir);
                        db_1.db.appendDeploymentLog(deploymentId, `[SIMULATION] Seeded workspace with React/Vite project template.`);
                    }
                    resolve(sourceDir);
                }
            }, 400);
        });
    }
    writeMockLaravelApp(dir) {
        fs.writeFileSync(path.join(dir, 'artisan'), '#!/usr/bin/env php\n<?php\n// Mock Laravel Artisan CLI');
        fs.mkdirSync(path.join(dir, 'bootstrap'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'bootstrap/app.php'), '<?php\n// Bootstrap Laravel');
        fs.mkdirSync(path.join(dir, 'routes'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'routes/web.php'), '<?php\nRoute::get("/", function() { return view("welcome"); });');
        const composerJson = {
            name: "laravel/laravel",
            require: {
                "php": "^8.2",
                "laravel/framework": "^10.0"
            }
        };
        fs.writeFileSync(path.join(dir, 'composer.json'), JSON.stringify(composerJson, null, 2));
        fs.writeFileSync(path.join(dir, 'composer.lock'), '{}');
    }
    writeMockReactApp(dir) {
        fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src/main.jsx'), 'import React from "react";\nconsole.log("React app initialized");');
        fs.writeFileSync(path.join(dir, 'index.html'), '<!DOCTYPE html><html><body><div id="root"></div></body></html>');
        const packageJson = {
            name: "react-vite-app",
            scripts: {
                "build": "vite build",
                "start": "vite preview"
            },
            dependencies: {
                "react": "^18.2.0",
                "react-dom": "^18.2.0"
            },
            devDependencies: {
                "vite": "^5.0.0"
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));
        fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    }
    writeMockNextApp(dir) {
        fs.mkdirSync(path.join(dir, 'src/app'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src/app/page.tsx'), 'export default function Home() { return <h1>NextJS App</h1> }');
        fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = { output: "standalone" };');
        const packageJson = {
            name: "nextjs-app",
            scripts: {
                "build": "next build",
                "start": "next start"
            },
            dependencies: {
                "next": "^14.0.0",
                "react": "^18.2.0",
                "react-dom": "^18.2.0"
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));
        fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    }
}
exports.GitService = GitService;
exports.gitService = new GitService();
