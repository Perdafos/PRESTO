# PRESTO - PaaS Deployment Engine

A lightweight, developer-oriented Platform as a Service (PaaS) deployment engine. It automates the software delivery pipeline from GitHub Webhook reception to live container orchestration and dynamic Nginx reverse proxy routing.

This engine is designed to be fully containerized using **Docker Compose** and **Nginx** for a production-ready server environment.

---

## Features

- **GitHub Webhook Validation**: Implements raw-body HMAC-SHA256 signature verification and delivery idempotency caching.
- **Queue Pipeline**: Asynchronous build queue backed by BullMQ and Redis.
- **Framework Detection**: Scans workspace patterns to identify Laravel (PHP), React (Vite/SPA), and Next.js (SSR) projects.
- **Dynamic Docker Builds**: Generates optimal multi-stage Dockerfiles and executes builds with memory/CPU resource bounds.
- **Nginx Reverse Proxy Routing**: Upserts upstream routings on the fly using dynamically written Nginx configurations and hot-reload.
- **Minimalist Developer Dashboard**: Built with Tailwind CSS and Lucide SVG icons. Features light/dark theme toggles, system resource telemetry, and real-time ANSI terminal log streaming.

---

## Getting Started

### Method A: Automated Installation (Recommended)

We provide an interactive setup wizard script that handles system packages installation, environment configuration, database key generation, and launches everything via Docker Compose:

```bash
chmod +x setup.sh
./setup.sh
```

### Method B: Manual Installation (Docker Compose)

Make sure your server has the following installed:
1. **Docker**: `sudo apt install -y docker.io`
2. **Docker Compose**: `sudo apt install -y docker-compose`

### Manual Steps

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/Perdafos/PRESTO.git
   cd PRESTO
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Generate secure secrets and configure `.env`:
   - `WEBHOOK_SECRET`: Secure GitHub Webhook secret.
   - `ENCRYPTION_KEY`: A 32-character encryption key for the database credentials.

3. **Deploy using Docker Compose**:
   ```bash
   docker-compose up -d --build
   ```

PRESTO will launch three services:
- `presto-app`: The Node/Hono engine running on port `3000` (internal).
- `presto-redis`: BullMQ's queue broker running on port `6379` (internal).
- `presto-nginx`: The Nginx reverse proxy exposed on port `80` (external).

---

## Architecture & How It Works

1. **GitHub Webhook Reception**: The engine listens at `http://<your-domain>/webhook/github`. When a push is received, it verifies the signature, creates a deployment record, and pushes a build job onto the BullMQ Redis queue.
2. **Workspace Setup & Cloning**: The worker pops the build job, clones the branch from Git using isolated environments, and runs the detection scanner.
3. **Framework Scanner**: Scans project structure to auto-detect React (SPA), Next.js (SSR), or Laravel (PHP) and writes an optimized Dockerfile.
4. **Docker Image Build**: Builds a production Docker image labeled with metadata (`paas.project_id`, `paas.deployment_id`).
5. **Container Orchestration**: Spins up a container on the host Docker daemon, allocates a dynamic port, and injects decrypted environment variables.
6. **Nginx Dynamic Routing**: The engine writes a proxy server block under `./nginx/conf.d/project_<project_id>.conf` pointing `http://<project-domain>` to `http://host.docker.internal:<allocated_port>`, and runs `docker exec presto-nginx nginx -s reload` to hot-reload routing rules with zero downtime.

---

## License & Copyright

This software and technology are copyrighted property. All rights reserved.

Copyright (c) 2026 Perdafos.
