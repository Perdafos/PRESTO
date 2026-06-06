import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';

import { config } from './config';
import { db } from './db';
import { verifySignature, encrypt } from './services/crypto';
import { queue } from './queue';
import { startWorker } from './queue/worker';
import { initializeNotifier, broadcastToDashboard } from './services/notifier';

const app = new Hono();

// Idempotency cache for webhook deliveries
const processedWebhookDeliveries = new Set<string>();

// --- REST API MIDDLEWARES & CORS ---
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-GitHub-Event, X-Hub-Signature-256');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  if (c.req.method === 'OPTIONS') {
    return c.text('OK');
  }
  await next();
});

// --- GitHub Webhook Endpoint ---
app.post('/webhook/github', async (c) => {
  const event = c.req.header('X-GitHub-Event');
  const delivery = c.req.header('X-GitHub-Delivery');
  const signature = c.req.header('X-Hub-Signature-256');
  const contentType = c.req.header('Content-Type');

  // Verify headers
  if (!event || !delivery || !contentType) {
    return c.json({ error: 'Missing critical GitHub webhook headers.' }, 400);
  }

  // Idempotency check
  if (processedWebhookDeliveries.has(delivery)) {
    return c.json({ status: 'already_processed', delivery }, 200);
  }
  processedWebhookDeliveries.add(delivery);
  // Keep size constrained
  if (processedWebhookDeliveries.size > 1000) {
    processedWebhookDeliveries.delete(processedWebhookDeliveries.values().next().value!);
  }

  // Read raw body for signature verification
  const rawBodyBuffer = Buffer.from(await c.req.arrayBuffer());

  // Handle ping
  if (event === 'ping') {
    return c.json({ status: 'pong' }, 200);
  }

  // Verify HMAC signature (skipped if webhook secret not configured or placeholder)
  if (signature && config.WEBHOOK_SECRET !== 'github_webhook_secret_key_here') {
    const isValid = verifySignature(signature, rawBodyBuffer, config.WEBHOOK_SECRET);
    if (!isValid) {
      console.warn(`[Webhook] Invalid signature received for delivery: ${delivery}`);
      return c.json({ error: 'Invalid HMAC signature.' }, 401);
    }
  }

  // Parse payload
  let payload: any;
  try {
    payload = JSON.parse(rawBodyBuffer.toString('utf-8'));
  } catch (err) {
    return c.json({ error: 'Invalid JSON payload.' }, 400);
  }

  // We only process push events
  if (event !== 'push') {
    return c.json({ status: 'ignored', event }, 200);
  }

  // Check branch push ref
  const ref = payload.ref; // refs/heads/main
  if (!ref) {
    return c.json({ error: 'Missing ref in payload.' }, 400);
  }

  const isDelete = payload.deleted === true;
  if (isDelete) {
    return c.json({ status: 'ignored', reason: 'branch_deletion' }, 200);
  }

  const branch = ref.replace('refs/heads/', '');
  const repoFullName = payload.repository?.full_name;

  if (!repoFullName) {
    return c.json({ error: 'Missing repository full name.' }, 400);
  }

  // Lookup project
  const project = db.getProjectByRepo(repoFullName);
  if (!project) {
    return c.json({ error: `Project not registered for repository: ${repoFullName}` }, 404);
  }

  // Verify branch
  if (branch !== project.branch) {
    return c.json({ status: 'branch_ignored', pushed: branch, target: project.branch }, 200);
  }

  // Prepare metadata
  const commitSha = payload.after || 'unknown';
  const commitMessage = payload.head_commit?.message || 'Triggered by push';
  const pusherName = payload.pusher?.name || 'github-webhook';

  // Create Deployment Record
  const deploymentId = uuidv4();
  db.saveDeployment({
    id: deploymentId,
    project_id: project.id,
    commit_sha: commitSha,
    commit_message: commitMessage,
    triggered_by: pusherName,
    status: 'queued',
    container_port: null,
    live_url: null,
    logs: `[${new Date().toISOString()}] Webhook received from GitHub. Added to deployment queue.\n`,
    duration_ms: null,
    created_at: new Date().toISOString(),
    completed_at: null
  });

  // Enqueue job
  await queue.addJob('build', {
    deployment_id: deploymentId,
    project_id: project.id,
    repo_full_name: project.repo_full_name,
    repo_clone_url: project.clone_url,
    is_private: project.is_private,
    commit_sha: commitSha,
    commit_message: commitMessage,
    deployment_branch: project.branch,
    domain: project.name + '.localpaas.com', // custom internal domain
    env_vars_encrypted: project.env_vars
  });

  return c.json({ deployment_id: deploymentId, status: 'queued' }, 202);
});

// --- REST API Endpoints ---

// Get all projects
app.get('/api/projects', (c) => {
  return c.json(db.getProjects());
});

// Create new project
app.post('/api/projects', async (c) => {
  try {
    const body = await c.req.json();
    const { name, repo_full_name, clone_url, is_private, branch, env_vars } = body;

    if (!name || !repo_full_name || !clone_url || !branch) {
      return c.json({ error: 'Missing required parameters.' }, 400);
    }

    const projectId = 'proj_' + uuidv4().substring(0, 8);
    const envVarsString = JSON.stringify(env_vars || {});
    const encryptedEnvs = encrypt(envVarsString, config.ENCRYPTION_KEY);

    const newProject = {
      id: projectId,
      name,
      repo_full_name,
      clone_url,
      is_private: !!is_private,
      branch,
      env_vars: encryptedEnvs,
      created_at: new Date().toISOString()
    };

    db.saveProject(newProject);
    broadcastToDashboard({ type: 'project-created', project: newProject });

    return c.json(newProject, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Get all deployments
app.get('/api/deployments', (c) => {
  const projectId = c.req.query('projectId');
  let deployments = db.getDeployments();
  if (projectId) {
    deployments = deployments.filter(d => d.project_id === projectId);
  }
  // Exclude massive logs field for lighter payload
  const list = deployments.map(d => ({
    id: d.id,
    project_id: d.project_id,
    commit_sha: d.commit_sha,
    commit_message: d.commit_message,
    triggered_by: d.triggered_by,
    status: d.status,
    container_port: d.container_port,
    live_url: d.live_url,
    duration_ms: d.duration_ms,
    created_at: d.created_at,
    completed_at: d.completed_at
  }));
  return c.json(list);
});

// Get deployment logs
app.get('/api/deployments/:id/logs', (c) => {
  const id = c.req.param('id');
  const d = db.getDeployment(id);
  if (!d) return c.json({ error: 'Deployment not found' }, 404);
  return c.json({ logs: d.logs });
});

// Manual deployment trigger
app.post('/api/projects/:id/deploy', async (c) => {
  const id = c.req.param('id');
  const project = db.getProject(id);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const deploymentId = uuidv4();
  db.saveDeployment({
    id: deploymentId,
    project_id: project.id,
    commit_sha: 'manual-' + uuidv4().substring(0, 7),
    commit_message: 'Manual deployment triggered from dashboard',
    triggered_by: 'dashboard-admin',
    status: 'queued',
    container_port: null,
    live_url: null,
    logs: `[${new Date().toISOString()}] Manual deployment triggered. Added to deployment queue.\n`,
    duration_ms: null,
    created_at: new Date().toISOString(),
    completed_at: null
  });

  await queue.addJob('build', {
    deployment_id: deploymentId,
    project_id: project.id,
    repo_full_name: project.repo_full_name,
    repo_clone_url: project.clone_url,
    is_private: project.is_private,
    commit_sha: 'manual',
    commit_message: 'Manual deployment',
    deployment_branch: project.branch,
    domain: project.name + '.localpaas.com',
    env_vars_encrypted: project.env_vars
  });

  return c.json({ deployment_id: deploymentId, status: 'queued' }, 202);
});

// --- Server Statistics endpoint ---
app.get('/api/sys-stats', async (c) => {
  const os = require('os');
  const stats = {
    cpuLoad: os.loadavg()[0],
    freeMem: (os.freemem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
    totalMem: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
    uptime: (os.uptime() / 3600).toFixed(2) + ' hours',
    queueWaiting: await queue.getWaitingCount(),
    queueActive: await queue.getActiveCount()
  };
  return c.json(stats);
});

// Get public configs
app.get('/api/config', (c) => {
  return c.json({
    webhook_secret: config.WEBHOOK_SECRET
  });
});

// --- Serve Dashboard Frontend ---
// Mount public assets
app.use('/*', serveStatic({ root: './frontend/dist' }));

// Start app server
const port = config.PORT;
const server = serve({
  fetch: app.fetch,
  port
}, (info) => {
  console.log(`[Server] Hono Web Server running at http://localhost:${info.port}`);
});

// Attach WebSocket server to the HTTP server
const wss = new WebSocketServer({ server: server as any });
initializeNotifier(wss);

// Start background workers
startWorker();
export default app;
