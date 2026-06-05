# PaaS Deployment Engine

A lightweight, developer-oriented Platform as a Service (PaaS) deployment engine. It automates the software delivery pipeline from GitHub Webhook reception to live container orchestration and dynamic reverse proxy routing.

The engine includes a built-in clean architecture adapter layer that runs in either **Simulation Mode** (zero-dependency local testing) or **Production Mode** (real Docker, Redis, and Caddy integration).

---

## Features

- **GitHub Webhook Validation**: Implements raw-body HMAC-SHA256 signature verification and delivery idempotency caching.
- **Queue Pipeline**: Asynchronous build queue with memory-based and BullMQ (Redis) adapters.
- **Framework Detection**: Scans workspace patterns to identify Laravel (PHP), React (Vite/SPA), and Next.js (SSR) projects.
- **Dynamic Docker builds**: Generates optimal multi-stage Dockerfiles and executes builds with memory/CPU resource bounds.
- **Caddy Reverse Proxy Routing**: Upserts upstream routings on the fly using Caddy Admin API.
- **Minimalist Developer Dashboard**: Built with Tailwind CSS v4 and Lucide SVG icons. Features light/dark theme toggles, system resource telemetry, and real-time ANSI terminal log streaming.
- **Webhook Simulator**: Integrated webhook payload simulator to test the build orchestration locally.

---

## Getting Started

### 1. Installation

Clone the repository and install the dependencies:

```bash
git clone https://github.com/Perdafos/PRESTO.git
cd PRESTO
npm install
```

### 2. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Configure your variables inside `.env`:

```env
PORT=3000
WEBHOOK_SECRET=your_github_webhook_secret
ENCRYPTION_KEY=your_32_character_encryption_key
SIMULATION_MODE=true # Set to false for real Docker/Caddy deployment
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

---

## Modes of Operation

### Mode A: Simulation Mode (`SIMULATION_MODE=true`)

Designed for local sandboxing, developer testing, and demo presentations. It runs immediately on any OS (including Windows, macOS, and Linux) without requiring external services.

- **Queue**: Uses an in-memory event-driven queue mirroring BullMQ.
- **Git & Build**: Simulates checkout speeds and writes framework-accurate workspace templates.
- **Docker**: Runs lightweight background HTTP servers to simulate active containers passing health checks.
- **Caddy**: Logs dynamic routing registrations in memory.

To run:
```bash
npm run dev
```
Open your browser at `http://localhost:3000`.

### Mode B: Production Mode (`SIMULATION_MODE=false`)

Designed for live deployments on Ubuntu Server. It executes real commands, builds real Docker images, and updates your proxy configuration.

#### System Prerequisites (Ubuntu Server)

1. **Git**:
   ```bash
   sudo apt install -y git
   ```
2. **Redis** (for BullMQ queues):
   ```bash
   sudo apt install -y redis-server
   ```
3. **Docker Engine**:
   ```bash
   sudo apt install -y docker.io
   sudo usermod -aG docker $USER
   newgrp docker
   docker network create paas_network
   ```
4. **Caddy Server** (Admin API enabled on localhost:2019):
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update
   sudo apt install -y caddy
   ```

#### Run Production Server

Compile the Tailwind CSS styles and build the TypeScript application:

```bash
npm run build
npm start
```

---

## Process Management (PM2)

For production environments, manage the server process using PM2 to handle automatic reboots and background logging:

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the compiled distribution
pm2 start dist/index.js --name paas-engine

# Configure PM2 to start on system boot
pm2 startup
pm2 save
```

---

## License & Copyright

This software and technology are copyrighted property. All rights reserved.

Copyright (c) 2026 Perdafos.

