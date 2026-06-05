import * as fs from 'fs';
import * as path from 'path';
import { Project, Deployment, Route, DeploymentStatus } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

interface Schema {
  projects: Project[];
  deployments: Deployment[];
  routes: Route[];
}

class JsonDatabase {
  private cache: Schema | null = null;
  private isWriting = false;

  constructor() {
    this.init();
  }

  private init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(DB_FILE)) {
      const initialSchema: Schema = {
        projects: [],
        deployments: [],
        routes: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialSchema, null, 2), 'utf-8');
      this.cache = initialSchema;
    } else {
      this.read();
    }
  }

  private read(): Schema {
    if (this.cache) return this.cache;
    try {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      this.cache = JSON.parse(content);
      return this.cache!;
    } catch (error) {
      console.error('Failed to read database file, resetting cache:', error);
      const fallback: Schema = { projects: [], deployments: [], routes: [] };
      this.cache = fallback;
      return fallback;
    }
  }

  private write() {
    if (!this.cache) return;
    if (this.isWriting) {
      // Simple queue/lock mechanism
      setTimeout(() => this.write(), 10);
      return;
    }

    this.isWriting = true;
    try {
      const tempFile = `${DB_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(this.cache, null, 2), 'utf-8');
      fs.renameSync(tempFile, DB_FILE);
    } catch (error) {
      console.error('Failed to write database file:', error);
    } finally {
      this.isWriting = false;
    }
  }

  // --- Projects ---
  getProjects(): Project[] {
    return this.read().projects;
  }

  getProject(id: string): Project | undefined {
    return this.getProjects().find(p => p.id === id);
  }

  getProjectByRepo(repoFullName: string): Project | undefined {
    return this.getProjects().find(
      p => p.repo_full_name.toLowerCase() === repoFullName.toLowerCase()
    );
  }

  saveProject(project: Project): void {
    const schema = this.read();
    const index = schema.projects.findIndex(p => p.id === project.id);
    if (index >= 0) {
      schema.projects[index] = project;
    } else {
      schema.projects.push(project);
    }
    this.write();
  }

  // --- Deployments ---
  getDeployments(): Deployment[] {
    return this.read().deployments;
  }

  getDeployment(id: string): Deployment | undefined {
    return this.getDeployments().find(d => d.id === id);
  }

  getDeploymentsByProject(projectId: string): Deployment[] {
    return this.getDeployments().filter(d => d.project_id === projectId);
  }

  saveDeployment(deployment: Deployment): void {
    const schema = this.read();
    const index = schema.deployments.findIndex(d => d.id === deployment.id);
    if (index >= 0) {
      schema.deployments[index] = deployment;
    } else {
      schema.deployments.push(deployment);
    }
    this.write();
  }

  appendDeploymentLog(id: string, logLine: string): void {
    const schema = this.read();
    const deployment = schema.deployments.find(d => d.id === id);
    if (deployment) {
      const timestamp = new Date().toISOString();
      const formattedLine = `[${timestamp}] ${logLine}\n`;
      deployment.logs += formattedLine;
      this.write();
      
      // Notify active log subscribers via a callback/event
      if (logCallback) {
        logCallback(id, formattedLine, deployment.status);
      }
    }
  }

  updateDeploymentStatus(id: string, status: DeploymentStatus, errorMsg?: string): void {
    const schema = this.read();
    const deployment = schema.deployments.find(d => d.id === id);
    if (deployment) {
      deployment.status = status;
      if (status === 'live' || status.endsWith('_failed')) {
        deployment.completed_at = new Date().toISOString();
        if (deployment.created_at) {
          deployment.duration_ms = 
            new Date(deployment.completed_at).getTime() - new Date(deployment.created_at).getTime();
        }
      }
      if (errorMsg) {
        this.appendDeploymentLog(id, `ERROR: ${errorMsg}`);
      }
      this.write();
      
      if (logCallback) {
        logCallback(id, `[STATUS CHANGE] Status is now: ${status.toUpperCase()}\n`, status);
      }
    }
  }

  // --- Routes ---
  getRoutes(): Route[] {
    return this.read().routes;
  }

  getRouteByDomain(domain: string): Route | undefined {
    return this.getRoutes().find(r => r.domain === domain);
  }

  getRouteByProject(projectId: string): Route | undefined {
    return this.getRoutes().find(r => r.project_id === projectId);
  }

  saveRoute(route: Route): void {
    const schema = this.read();
    const index = schema.routes.findIndex(r => r.project_id === route.project_id);
    if (index >= 0) {
      schema.routes[index] = route;
    } else {
      schema.routes.push(route);
    }
    this.write();
  }

  deleteRoute(projectId: string): void {
    const schema = this.read();
    schema.routes = schema.routes.filter(r => r.project_id !== projectId);
    this.write();
  }
}

// Global logger subscription callback for WebSockets
let logCallback: ((deploymentId: string, logLine: string, status: DeploymentStatus) => void) | null = null;

export function registerLogCallback(cb: typeof logCallback) {
  logCallback = cb;
}

export const db = new JsonDatabase();
export { JsonDatabase };
export * from './types';
export * from '../config'; // Config is located in src/config

