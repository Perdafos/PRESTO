import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { db } from '../db';
import { config } from '../config';

export class GitService {
  /**
   * Clones a repository to a deployment workspace.
   * If in simulation mode, it simulates cloning and writes mock files.
   */
  async clone(
    deploymentId: string,
    repoUrl: string,
    branch: string,
    isPrivate: boolean,
    sshKeyRef?: string
  ): Promise<string> {
    const deployDir = path.join(config.BUILDS_DIR, deploymentId);
    const sourceDir = path.join(deployDir, 'source');
    const dockerDir = path.join(deployDir, 'docker');
    const logsDir = path.join(deployDir, 'logs');

    // Create directories
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(dockerDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    db.appendDeploymentLog(deploymentId, `Preparing isolated environment at ${sourceDir}`);

    if (config.SIMULATION_MODE) {
      return this.simulateClone(deploymentId, repoUrl, branch, sourceDir);
    }

    return new Promise((resolve, reject) => {
      db.appendDeploymentLog(deploymentId, `Initiating git clone for branch [${branch}]...`);
      
      let tempKeyPath = '';
      let tempConfigPath = '';
      const env: NodeJS.ProcessEnv = { ...process.env };

      if (isPrivate && sshKeyRef) {
        db.appendDeploymentLog(deploymentId, `Fetching SSH Deploy Key from vault (ref: ${sshKeyRef})...`);
        try {
          // In real setup, decrypt SSH key from DB / Vault.
          // For now, look up a mock key or decrypt the mock SSH key.
          const project = db.getProjects().find(p => p.id === db.getDeployment(deploymentId)?.project_id);
          // Simple mock SSH key contents
          const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----\nMOCKKEY...\n-----END OPENSSH PRIVATE KEY-----`;
          
          tempKeyPath = path.join(process.cwd(), `data/temp_ssh_${deploymentId}`);
          tempConfigPath = path.join(process.cwd(), `data/temp_ssh_config_${deploymentId}`);

          fs.writeFileSync(tempKeyPath, privateKey, { mode: 0o600 });
          
          const sshConfig = `Host github.com\n  IdentityFile ${tempKeyPath}\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n`;
          fs.writeFileSync(tempConfigPath, sshConfig);

          env.GIT_SSH_COMMAND = `ssh -F ${tempConfigPath}`;
          db.appendDeploymentLog(deploymentId, `Configured SSH agent with key isolation.`);
        } catch (err: any) {
          db.appendDeploymentLog(deploymentId, `Failed to configure SSH credentials: ${err.message}`);
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

      db.appendDeploymentLog(deploymentId, `git ${gitArgs.join(' ')}`);

      const gitProcess = spawn('git', gitArgs, { env });
      const logStream = fs.createWriteStream(path.join(logsDir, 'clone.log'));

      gitProcess.stdout.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          db.appendDeploymentLog(deploymentId, `[git] ${line}`);
          logStream.write(data);
        }
      });

      gitProcess.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          db.appendDeploymentLog(deploymentId, `[git-err] ${line}`);
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
          db.appendDeploymentLog(deploymentId, `Git clone completed successfully.`);
          resolve(sourceDir);
        } else {
          db.appendDeploymentLog(deploymentId, `Git clone failed with exit code ${code}`);
          reject(new Error(`Git clone failed with code ${code}`));
        }
      });

      gitProcess.on('error', (err) => {
        if (tempKeyPath && fs.existsSync(tempKeyPath)) fs.unlinkSync(tempKeyPath);
        if (tempConfigPath && fs.existsSync(tempConfigPath)) fs.unlinkSync(tempConfigPath);
        
        db.appendDeploymentLog(deploymentId, `Failed to spawn git command: ${err.message}`);
        reject(err);
      });
    });
  }

  private async simulateClone(
    deploymentId: string,
    repoUrl: string,
    branch: string,
    sourceDir: string
  ): Promise<string> {
    return new Promise((resolve) => {
      db.appendDeploymentLog(deploymentId, `[SIMULATION] Starting mock git clone...`);
      
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
          db.appendDeploymentLog(deploymentId, `[SIMULATION-git] ${steps[stepIdx]}`);
          stepIdx++;
        } else {
          clearInterval(interval);
          db.appendDeploymentLog(deploymentId, `[SIMULATION] Mock clone complete.`);

          // Determine which mock files to write based on the repository name or project name
          const deployment = db.getDeployment(deploymentId);
          const project = deployment ? db.getProject(deployment.project_id) : null;
          const projectName = (project?.name || '').toLowerCase();

          // Write template structures
          if (projectName.includes('laravel')) {
            this.writeMockLaravelApp(sourceDir);
            db.appendDeploymentLog(deploymentId, `[SIMULATION] Seeded workspace with Laravel project template.`);
          } else if (projectName.includes('next')) {
            this.writeMockNextApp(sourceDir);
            db.appendDeploymentLog(deploymentId, `[SIMULATION] Seeded workspace with Next.js project template.`);
          } else {
            // Default to React
            this.writeMockReactApp(sourceDir);
            db.appendDeploymentLog(deploymentId, `[SIMULATION] Seeded workspace with React/Vite project template.`);
          }

          resolve(sourceDir);
        }
      }, 400);
    });
  }

  private writeMockLaravelApp(dir: string) {
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

  private writeMockReactApp(dir: string) {
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

  private writeMockNextApp(dir: string) {
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

export const gitService = new GitService();
