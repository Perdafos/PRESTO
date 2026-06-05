"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.caddyService = exports.CaddyService = void 0;
const db_1 = require("../db");
const config_1 = require("../config");
// Simulated Caddy routing configurations stored in memory
const simulatedRoutes = new Map();
class CaddyService {
    /**
     * Configures a routing rule in Caddy for a project domain.
     */
    async upsertRoute(projectId, deploymentId, domain, allocatedPort) {
        db_1.db.appendDeploymentLog(deploymentId, `Configuring Caddy proxy: https://${domain} -> http://localhost:${allocatedPort}`);
        if (config_1.config.SIMULATION_MODE) {
            simulatedRoutes.set(projectId, { domain, port: allocatedPort, deploymentId });
            db_1.db.appendDeploymentLog(deploymentId, `[SIMULATION-caddy] Upserted route rule route_${projectId}`);
            db_1.db.appendDeploymentLog(deploymentId, `[SIMULATION-caddy] SSL Certificate issued for domain ${domain} via Let's Encrypt (mocked).`);
            return;
        }
        const caddyUrl = `http://localhost:2019/id/route_${projectId}`;
        // Caddy API JSON Configuration
        const caddyConfig = {
            "@id": `route_${projectId}`,
            "match": [
                {
                    "host": [domain]
                }
            ],
            "handle": [
                {
                    "handler": "reverse_proxy",
                    "upstreams": [
                        {
                            "dial": `localhost:${allocatedPort}`
                        }
                    ],
                    "headers": {
                        "request": {
                            "set": {
                                "X-Forwarded-For": ["{http.request.remote.host}"],
                                "X-Real-IP": ["{http.request.remote.host}"],
                                "X-Deployment-ID": [deploymentId]
                            }
                        }
                    }
                }
            ],
            "terminal": true
        };
        try {
            db_1.db.appendDeploymentLog(deploymentId, `Sending PUT payload to Caddy Admin API: ${caddyUrl}`);
            const response = await fetch(caddyUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(caddyConfig)
            });
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Caddy API error (${response.status}): ${errText}`);
            }
            db_1.db.appendDeploymentLog(deploymentId, `Caddy routing update succeeded. Domain active.`);
        }
        catch (err) {
            db_1.db.appendDeploymentLog(deploymentId, `Caddy routing update failed: ${err.message}`);
            throw err;
        }
    }
    /**
     * Removes a routing rule.
     */
    async deleteRoute(projectId) {
        if (config_1.config.SIMULATION_MODE) {
            simulatedRoutes.delete(projectId);
            console.log(`[SIMULATION-caddy] Deleted route route_${projectId}`);
            return;
        }
        const caddyUrl = `http://localhost:2019/id/route_${projectId}`;
        try {
            const response = await fetch(caddyUrl, {
                method: 'DELETE'
            });
            if (response.status !== 404 && !response.ok) {
                const errText = await response.text();
                throw new Error(`Caddy API error (${response.status}): ${errText}`);
            }
            console.log(`Caddy route route_${projectId} successfully deleted.`);
        }
        catch (err) {
            console.error(`Failed to delete Caddy route: ${err.message}`);
        }
    }
    /**
     * Helper to check active simulated routes
     */
    getSimulatedRoutes() {
        return Array.from(simulatedRoutes.entries()).map(([projectId, route]) => ({
            projectId,
            ...route
        }));
    }
}
exports.CaddyService = CaddyService;
exports.caddyService = new CaddyService();
