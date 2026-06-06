# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend and combine
FROM node:20-alpine
WORKDIR /app

# Install system dependencies (docker CLI, git, openssh-client)
RUN apk add --no-cache docker-cli git openssh-client

# Copy package files and install backend dependencies
COPY package*.json ./
RUN npm ci
RUN chmod +x node_modules/.bin/tsc

# Copy backend source code and tsconfig
COPY tsconfig.json ./
COPY src/ ./src/

# Build backend
RUN npx tsc

# Copy built frontend assets from stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose backend port
EXPOSE 3000

# Start server
CMD ["node", "dist/index.js"]
