import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import * as util from 'util';
import { db } from '../db';
import { config } from '../config';

const execPromise = util.promisify(exec);

export class NginxService {
  /**
   * Configures a routing rule in Nginx for a project domain.
   */
  async upsertRoute(
    projectId: string,
    deploymentId: string,
    domain: string,
    allocatedPort: number
  ): Promise<void> {
    db.appendDeploymentLog(deploymentId, `Configuring Nginx proxy: http://${domain} -> http://${config.NGINX.upstreamHost}:${allocatedPort}`);

    // Ensure config directory exists
    if (!fs.existsSync(config.NGINX.confDir)) {
      fs.mkdirSync(config.NGINX.confDir, { recursive: true });
    }

    const confPath = path.join(config.NGINX.confDir, `project_${projectId}.conf`);

    const nginxConfig = `server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://${config.NGINX.upstreamHost}:${allocatedPort};
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
      db.appendDeploymentLog(deploymentId, `Writing Nginx configuration to ${confPath}`);
      fs.writeFileSync(confPath, nginxConfig, 'utf-8');

      db.appendDeploymentLog(deploymentId, `Executing Nginx reload command: ${config.NGINX.reloadCmd}`);
      const { stdout, stderr } = await execPromise(config.NGINX.reloadCmd);
      if (stderr && stderr.trim()) {
        db.appendDeploymentLog(deploymentId, `Nginx reload stderr: ${stderr}`);
      }
      db.appendDeploymentLog(deploymentId, `Nginx routing update succeeded. Domain active.`);
    } catch (err: any) {
      db.appendDeploymentLog(deploymentId, `Nginx routing update failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Removes a routing rule.
   */
  async deleteRoute(projectId: string): Promise<void> {
    const confPath = path.join(config.NGINX.confDir, `project_${projectId}.conf`);

    try {
      if (fs.existsSync(confPath)) {
        fs.unlinkSync(confPath);
        console.log(`Deleted Nginx config file: ${confPath}`);
        
        console.log(`Executing Nginx reload command: ${config.NGINX.reloadCmd}`);
        await execPromise(config.NGINX.reloadCmd);
        console.log(`Nginx route route_${projectId} successfully deleted.`);
      } else {
        console.log(`Nginx config file not found, skipping delete: ${confPath}`);
      }
    } catch (err: any) {
      console.error(`Failed to delete Nginx route: ${err.message}`);
    }
  }
}

export const nginxService = new NginxService();
