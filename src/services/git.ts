import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { db } from '../db';
import { config } from '../config';

export class GitService {
  /**
   * Clones a repository to a deployment workspace.
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

    return new Promise((resolve, reject) => {
      db.appendDeploymentLog(deploymentId, `Initiating git clone for branch [${branch}]...`);
      
      let tempKeyPath = '';
      let tempConfigPath = '';
      const env: NodeJS.ProcessEnv = { ...process.env };

      if (isPrivate && sshKeyRef) {
        db.appendDeploymentLog(deploymentId, `Fetching SSH Deploy Key from vault (ref: ${sshKeyRef})...`);
        try {
          const project = db.getProjects().find(p => p.id === db.getDeployment(deploymentId)?.project_id);
          // Standard SSH setup
          const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----\n${sshKeyRef}\n-----END OPENSSH PRIVATE KEY-----`;
          
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
}

export const gitService = new GitService();
