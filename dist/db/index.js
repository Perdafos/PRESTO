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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonDatabase = exports.db = void 0;
exports.registerLogCallback = registerLogCallback;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
class JsonDatabase {
    cache = null;
    isWriting = false;
    constructor() {
        this.init();
    }
    init() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(DB_FILE)) {
            const initialSchema = {
                projects: [],
                deployments: [],
                routes: []
            };
            fs.writeFileSync(DB_FILE, JSON.stringify(initialSchema, null, 2), 'utf-8');
            this.cache = initialSchema;
        }
        else {
            this.read();
        }
    }
    read() {
        if (this.cache)
            return this.cache;
        try {
            const content = fs.readFileSync(DB_FILE, 'utf-8');
            this.cache = JSON.parse(content);
            return this.cache;
        }
        catch (error) {
            console.error('Failed to read database file, resetting cache:', error);
            const fallback = { projects: [], deployments: [], routes: [] };
            this.cache = fallback;
            return fallback;
        }
    }
    write() {
        if (!this.cache)
            return;
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
        }
        catch (error) {
            console.error('Failed to write database file:', error);
        }
        finally {
            this.isWriting = false;
        }
    }
    // --- Projects ---
    getProjects() {
        return this.read().projects;
    }
    getProject(id) {
        return this.getProjects().find(p => p.id === id);
    }
    getProjectByRepo(repoFullName) {
        return this.getProjects().find(p => p.repo_full_name.toLowerCase() === repoFullName.toLowerCase());
    }
    saveProject(project) {
        const schema = this.read();
        const index = schema.projects.findIndex(p => p.id === project.id);
        if (index >= 0) {
            schema.projects[index] = project;
        }
        else {
            schema.projects.push(project);
        }
        this.write();
    }
    // --- Deployments ---
    getDeployments() {
        return this.read().deployments;
    }
    getDeployment(id) {
        return this.getDeployments().find(d => d.id === id);
    }
    getDeploymentsByProject(projectId) {
        return this.getDeployments().filter(d => d.project_id === projectId);
    }
    saveDeployment(deployment) {
        const schema = this.read();
        const index = schema.deployments.findIndex(d => d.id === deployment.id);
        if (index >= 0) {
            schema.deployments[index] = deployment;
        }
        else {
            schema.deployments.push(deployment);
        }
        this.write();
    }
    appendDeploymentLog(id, logLine) {
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
    updateDeploymentStatus(id, status, errorMsg) {
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
    getRoutes() {
        return this.read().routes;
    }
    getRouteByDomain(domain) {
        return this.getRoutes().find(r => r.domain === domain);
    }
    getRouteByProject(projectId) {
        return this.getRoutes().find(r => r.project_id === projectId);
    }
    saveRoute(route) {
        const schema = this.read();
        const index = schema.routes.findIndex(r => r.project_id === route.project_id);
        if (index >= 0) {
            schema.routes[index] = route;
        }
        else {
            schema.routes.push(route);
        }
        this.write();
    }
    deleteRoute(projectId) {
        const schema = this.read();
        schema.routes = schema.routes.filter(r => r.project_id !== projectId);
        this.write();
    }
}
exports.JsonDatabase = JsonDatabase;
// Global logger subscription callback for WebSockets
let logCallback = null;
function registerLogCallback(cb) {
    logCallback = cb;
}
exports.db = new JsonDatabase();
__exportStar(require("./types"), exports);
__exportStar(require("../config"), exports); // Config is located in src/config
