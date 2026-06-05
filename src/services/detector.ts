import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db';

export type DetectedFramework = 'LARAVEL' | 'REACT' | 'NEXTJS' | 'LARAVEL_INERTIA';

export interface DetectionResult {
  framework: DetectedFramework;
  phpVersion?: string;
  nodeVersion?: string;
  buildCommand?: string;
  startCommand?: string;
  internalPort: number;
}

export class DetectorService {
  /**
   * Detects the framework of a project inside sourceDir.
   */
  async detect(deploymentId: string, sourceDir: string): Promise<DetectionResult> {
    db.appendDeploymentLog(deploymentId, `Starting framework detection scanning...`);
    
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Source directory does not exist: ${sourceDir}`);
    }

    const rootFiles = fs.readdirSync(sourceDir);
    db.appendDeploymentLog(deploymentId, `Root directory contents: ${rootFiles.join(', ')}`);

    let laravelScore = 0;
    let reactScore = 0;
    let nextScore = 0;

    let phpVersion = '8.2';
    let nodeVersion = '20';
    let buildCommand = '';
    let startCommand = '';
    let isInertia = false;

    // 1. Gather signals
    const hasArtisan = rootFiles.includes('artisan');
    const hasComposerJson = rootFiles.includes('composer.json');
    const hasPackageJson = rootFiles.includes('package.json');
    const hasBootstrapApp = fs.existsSync(path.join(sourceDir, 'bootstrap/app.php'));
    const hasRoutesWeb = fs.existsSync(path.join(sourceDir, 'routes/web.php'));

    // Laravel Checks
    if (hasArtisan) laravelScore += 10;
    if (hasBootstrapApp) laravelScore += 10;
    if (hasRoutesWeb) laravelScore += 5;

    if (hasComposerJson) {
      try {
        const composerRaw = fs.readFileSync(path.join(sourceDir, 'composer.json'), 'utf-8');
        const composer = JSON.parse(composerRaw);
        
        const req = composer.require || {};
        if (req['laravel/framework']) {
          laravelScore += 15;
        }
        if (req['php']) {
          // Extract PHP version (e.g. "^8.2" -> "8.2")
          const phpMatch = req['php'].match(/(\d+\.\d+)/);
          if (phpMatch) phpVersion = phpMatch[1];
        }
        if (req['inertiajs/inertia-laravel']) {
          isInertia = true;
        }
      } catch (err: any) {
        db.appendDeploymentLog(deploymentId, `Warning reading composer.json: ${err.message}`);
      }
    }

    // Node / React / NextJS Checks
    if (hasPackageJson) {
      try {
        const pkgRaw = fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf-8');
        const pkg = JSON.parse(pkgRaw);
        
        const deps = pkg.dependencies || {};
        const devDeps = pkg.devDependencies || {};
        const scripts = pkg.scripts || {};

        if (deps['react'] || devDeps['react']) {
          reactScore += 15;
        }
        if (deps['next']) {
          nextScore += 20; // Definite NextJS signal
        }
        
        if (pkg.engines?.node) {
          const nodeMatch = pkg.engines.node.match(/(\d+)/);
          if (nodeMatch) nodeVersion = nodeMatch[1];
        }

        // Scripts
        if (scripts.build) buildCommand = scripts.build;
        if (scripts.start) startCommand = scripts.start;
      } catch (err: any) {
        db.appendDeploymentLog(deploymentId, `Warning reading package.json: ${err.message}`);
      }
    }

    const hasNextConfig = rootFiles.some(f => f.startsWith('next.config.'));
    if (hasNextConfig) nextScore += 10;

    const hasSrc = rootFiles.includes('src');
    if (hasSrc && hasPackageJson) reactScore += 8;

    db.appendDeploymentLog(
      deploymentId,
      `Signal scores -> Laravel: ${laravelScore}, React: ${reactScore}, NextJS: ${nextScore}`
    );

    // 2. Decision Logic
    let framework: DetectedFramework = 'REACT';
    let internalPort = 80; // React Nginx default

    if (laravelScore >= 15) {
      if (isInertia) {
        framework = 'LARAVEL_INERTIA';
        db.appendDeploymentLog(deploymentId, `Detected Framework: Laravel with InertiaJS`);
      } else {
        framework = 'LARAVEL';
        db.appendDeploymentLog(deploymentId, `Detected Framework: Pure Laravel`);
      }
      internalPort = 80; // Laravel runs Nginx/FPM exposing port 80
    } else if (nextScore >= 15) {
      framework = 'NEXTJS';
      db.appendDeploymentLog(deploymentId, `Detected Framework: Next.js (React SSR)`);
      internalPort = 3000; // Next.js default start port
    } else if (reactScore >= 15) {
      framework = 'REACT';
      db.appendDeploymentLog(deploymentId, `Detected Framework: React SPA`);
      internalPort = 80; // React built static files run on Nginx port 80
    } else {
      db.appendDeploymentLog(deploymentId, `No strong framework signals detected. Defaulting to React SPA.`);
      framework = 'REACT';
      internalPort = 80;
    }

    const result: DetectionResult = {
      framework,
      phpVersion,
      nodeVersion,
      buildCommand: buildCommand || (framework === 'NEXTJS' ? 'next build' : 'npm run build'),
      startCommand: startCommand || (framework === 'NEXTJS' ? 'next start' : 'npm start'),
      internalPort
    };

    // 3. Generate and write Dockerfile + .dockerignore
    await this.generateDockerResources(deploymentId, sourceDir, result);

    return result;
  }

  private async generateDockerResources(
    deploymentId: string,
    sourceDir: string,
    result: DetectionResult
  ) {
    const deployDir = path.dirname(sourceDir);
    const dockerfileDir = path.join(deployDir, 'docker');
    fs.mkdirSync(dockerfileDir, { recursive: true });

    const dockerfilePath = path.join(dockerfileDir, 'Dockerfile');
    const dockerignorePath = path.join(sourceDir, '.dockerignore');

    let dockerfileContent = '';
    let dockerignoreContent = '';

    switch (result.framework) {
      case 'LARAVEL':
        dockerfileContent = this.getLaravelDockerfile(result.phpVersion || '8.2');
        dockerignoreContent = `vendor/\n.env\nnode_modules/\nstorage/logs/*.log\n.git/\n`;
        break;

      case 'LARAVEL_INERTIA':
        dockerfileContent = this.getLaravelInertiaDockerfile(result.phpVersion || '8.2', result.nodeVersion || '20');
        dockerignoreContent = `vendor/\n.env\nnode_modules/\nstorage/logs/*.log\n.git/\n`;
        break;

      case 'NEXTJS':
        dockerfileContent = this.getNextjsDockerfile(result.nodeVersion || '20');
        dockerignoreContent = `node_modules/\n.next/\nout/\n.env*\n.git/\n`;
        break;

      case 'REACT':
      default:
        dockerfileContent = this.getReactDockerfile(result.nodeVersion || '20', result.buildCommand || 'npm run build');
        dockerignoreContent = `node_modules/\ndist/\nbuild/\n.env*\n.git/\n`;
        break;
    }

    fs.writeFileSync(dockerfilePath, dockerfileContent, 'utf-8');
    fs.writeFileSync(dockerignorePath, dockerignoreContent, 'utf-8');

    db.appendDeploymentLog(deploymentId, `Generated Dockerfile at ${dockerfilePath}`);
    db.appendDeploymentLog(deploymentId, `Generated .dockerignore at ${dockerignorePath}`);
  }

  // --- Dockerfile Templates ---

  private getReactDockerfile(nodeVer: string, buildCmd: string): string {
    return `# Stage 1: Build React static files
FROM node:${nodeVer}-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN ${buildCmd}

# Stage 2: Serve with Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# Standard SPA routing support in nginx configuration
RUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
  }

  private getNextjsDockerfile(nodeVer: string): string {
    return `# Multi-stage Dockerfile for NextJS Standalone Mode
FROM node:${nodeVer}-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
`;
  }

  private getLaravelDockerfile(phpVer: string): string {
    return `# Multi-stage Build for PHP Laravel
FROM php:${phpVer}-cli-alpine AS builder
WORKDIR /var/www/html
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
COPY composer*.json ./
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-scripts
COPY . .
RUN composer run-script post-autoload-dump

# Production stage with FPM & Nginx
FROM php:${phpVer}-fpm-alpine
WORKDIR /var/www/html
RUN apk add --no-cache nginx supervisor
COPY --from=builder /var/www/html /var/www/html
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

# Copy configs (nginx server, supervisor.conf)
# (In real deployment these files are written dynamically)
EXPOSE 80
CMD ["php-fpm"]
`;
  }

  private getLaravelInertiaDockerfile(phpVer: string, nodeVer: string): string {
    return `# Multi-stage Build for Laravel + Inertia (PHP + NodeJS)
FROM php:${phpVer}-cli-alpine AS builder
WORKDIR /var/www/html
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
COPY composer*.json ./
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-scripts

# NPM assets builder stage
FROM node:${nodeVer}-alpine AS node_builder
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# Runner stage
FROM php:${phpVer}-fpm-alpine
WORKDIR /var/www/html
RUN apk add --no-cache nginx supervisor
COPY --from=builder /var/www/html /var/www/html
COPY --from=node_builder /app/public/build /var/www/html/public/build
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache
EXPOSE 80
CMD ["php-fpm"]
`;
  }
}

export const detectorService = new DetectorService();
