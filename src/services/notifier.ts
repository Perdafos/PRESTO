import { WebSocket, WebSocketServer } from 'ws';
import { db, registerLogCallback, DeploymentStatus } from '../db';

interface Subscriber {
  ws: WebSocket;
  deploymentId: string;
}

const subscribers = new Set<Subscriber>();
const dashboardSubscribers = new Set<WebSocket>();

export function initializeNotifier(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket) => {
    console.log('[WebSocket] Client connected.');

    ws.on('message', (message: string) => {
      try {
        const payload = JSON.parse(message);
        
        if (payload.action === 'subscribe') {
          const { deploymentId } = payload;
          if (deploymentId) {
            // Remove any existing subscriptions for this socket
            for (const sub of subscribers) {
              if (sub.ws === ws) subscribers.delete(sub);
            }
            
            subscribers.add({ ws, deploymentId });
            console.log(`[WebSocket] Client subscribed to deployment: ${deploymentId}`);
            
            // Send existing logs immediately so the terminal is not empty
            const deployment = db.getDeployment(deploymentId);
            if (deployment) {
              ws.send(JSON.stringify({
                type: 'init-logs',
                logs: deployment.logs,
                status: deployment.status
              }));
            }
          }
        } else if (payload.action === 'subscribe-dashboard') {
          dashboardSubscribers.add(ws);
          console.log('[WebSocket] Client subscribed to dashboard events.');
          
          // Send initial states
          ws.send(JSON.stringify({
            type: 'init-dashboard',
            projects: db.getProjects(),
            deployments: db.getDeployments().map(d => ({
              id: d.id,
              project_id: d.project_id,
              commit_sha: d.commit_sha,
              status: d.status,
              created_at: d.created_at,
              duration_ms: d.duration_ms
            }))
          }));
        }
      } catch (err: any) {
        console.error('[WebSocket] Error parsing message:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('[WebSocket] Client disconnected.');
      // Clean up subscribers
      for (const sub of subscribers) {
        if (sub.ws === ws) subscribers.delete(sub);
      }
      dashboardSubscribers.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('[WebSocket] Socket error:', err.message);
    });
  });

  // Register database log callback to broadcast live streams
  registerLogCallback((deploymentId: string, logLine: string, status: DeploymentStatus) => {
    // 1. Send logs to deployment-specific subscribers
    for (const sub of subscribers) {
      if (sub.deploymentId === deploymentId) {
        if (sub.ws.readyState === WebSocket.OPEN) {
          sub.ws.send(JSON.stringify({
            type: 'log',
            deploymentId,
            logLine,
            status
          }));
        }
      }
    }

    // 2. Broadcast status updates to dashboard subscribers
    const deployment = db.getDeployment(deploymentId);
    if (deployment) {
      broadcastToDashboard({
        type: 'deployment-update',
        deployment: {
          id: deployment.id,
          project_id: deployment.project_id,
          commit_sha: deployment.commit_sha,
          status: deployment.status,
          created_at: deployment.created_at,
          duration_ms: deployment.duration_ms,
          live_url: deployment.live_url
        }
      });
    }
  });
}

/**
 * Broadcasts a message to all dashboard listeners.
 */
export function broadcastToDashboard(message: any) {
  const payload = JSON.stringify(message);
  for (const ws of dashboardSubscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * Sends notifications (e.g. webhook triggers or console updates) to user callbacks.
 */
export class NotificationService {
  async notifySuccess(deploymentId: string): Promise<void> {
    const deployment = db.getDeployment(deploymentId);
    if (!deployment) return;

    const project = db.getProject(deployment.project_id);
    const projectName = project ? project.name : 'PaaS App';

    console.log(`[Notification] Deployment SUCCESS for ${projectName} (URL: ${deployment.live_url})`);
    
    // Simulate webhook dispatch
    this.dispatchWebhook(deploymentId, 'success', deployment.live_url || '');
  }

  async notifyFailure(deploymentId: string, status: string, errorMsg: string): Promise<void> {
    const deployment = db.getDeployment(deploymentId);
    if (!deployment) return;

    const project = db.getProject(deployment.project_id);
    const projectName = project ? project.name : 'PaaS App';

    console.error(`[Notification] Deployment FAILED for ${projectName} at state: ${status}. Error: ${errorMsg}`);
    
    // Simulate webhook dispatch
    this.dispatchWebhook(deploymentId, 'failed', '', errorMsg);
  }

  private async dispatchWebhook(deploymentId: string, state: string, url: string, error?: string) {
    // Mock user webhook dispatching
    console.log(`[Notification] Dispatching mock user webhook for deployment ${deploymentId} with status: ${state}...`);
  }
}

export const notificationService = new NotificationService();
