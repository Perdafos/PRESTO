#!/usr/bin/env bash

# PRESTO PaaS Deployment Engine - Docker Server Setup Wizard
# Copyright (c) 2026 Perdafos. All rights reserved.

set -e

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

print_header() {
  echo -e "\n${MAGENTA}${BOLD}======================================================================${NC}"
  echo -e "${MAGENTA}${BOLD}  $1${NC}"
  echo -e "${MAGENTA}${BOLD}======================================================================${NC}"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

print_banner() {
  clear
  echo -e "${CYAN}${BOLD}"
  echo '  _____  _____  ______  _____ _______ ____ '
  echo ' |  __ \|  __ \|  ____|/ ____|__   __/ __ \'
  echo ' | |__) | |__) | |__  | (___    | | | |  | |'
  echo ' |  ___/|  _  /|  __|  \___ \   | | | |  | |'
  echo ' | |    | | \ \| |____ ____) |  | | | |__| |'
  echo ' |_|    |_|  \_\______|_____/   |_|  \____/ '
  echo -e "${NC}"
  echo -e "${BOLD}         PaaS Deployment Engine Server Setup Wizard (Docker)${NC}"
  echo -e "   --------------------------------------------------------"
  echo -e "   This script configures, installs, and runs PRESTO on your"
  echo -e "   Ubuntu/Debian server inside Docker Compose with Nginx."
  echo -e "   --------------------------------------------------------"
}

check_system() {
  print_header "System Compatibility Check"
  
  if [ "$(uname)" != "Linux" ]; then
    echo -e "${RED}[✗] Error: This installer is intended for Linux servers (Ubuntu/Debian).${NC}"
    exit 1
  fi

  if ! command_exists apt-get; then
    echo -e "${RED}[✗] Error: 'apt' package manager not found. This script requires Ubuntu/Debian.${NC}"
    exit 1
  fi
}

check_and_fix_lxc_containerd() {
  local is_lxc=false
  if [ -f /proc/1/environ ] && grep -q "container=lxc" /proc/1/environ; then
    is_lxc=true
  elif command_exists systemd-detect-virt && systemd-detect-virt --container | grep -q "lxc"; then
    is_lxc=true
  fi

  if [ "$is_lxc" = true ]; then
    echo -e "${YELLOW}[!] LXC virtualization detected. Checking containerd compatibility...${NC}"
    
    local pkg_name=""
    if dpkg -s containerd.io >/dev/null 2>&1; then
      pkg_name="containerd.io"
    elif dpkg -s containerd >/dev/null 2>&1; then
      pkg_name="containerd"
    fi

    if [ -n "$pkg_name" ]; then
      local version=$(dpkg-query --showformat='${Version}' --show "$pkg_name")
      echo -e "${CYAN}[*] Installed $pkg_name version: $version${NC}"
      
      if dpkg --compare-versions "$version" "ge" "1.7.28-2" || [[ "$version" == *"+u"* ]]; then
        echo -e "${YELLOW}[!] Problematic containerd version ($version) detected inside LXC.${NC}"
        echo -e "${CYAN}[*] Preparing to install/downgrade to a safe version of containerd.io (1.7.28-1)...${NC}"
        
        # Ensure Docker official repository is added to get containerd.io
        if [ ! -f "/etc/apt/sources.list.d/docker.list" ]; then
          echo -e "${CYAN}[*] Adding Docker official GPG key and repository...${NC}"
          sudo mkdir -p /etc/apt/keyrings
          
          local dist="ubuntu"
          if [ -f /etc/os-release ] && grep -q -i "debian" /etc/os-release; then
            dist="debian"
          fi
          
          sudo curl -fsSL "https://download.docker.com/linux/$dist/gpg" -o /etc/apt/keyrings/docker.asc 2>/dev/null || true
          sudo chmod a+r /etc/apt/keyrings/docker.asc 2>/dev/null || true
          
          local codename=$(lsb_release -cs)
          echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$dist $codename stable" | \
            sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
          sudo apt-get update -y
        fi
        
        # Check safe containerd.io version in apt cache
        local pkg_ver=$(apt-cache madison containerd.io | grep "1.7.28-1" | head -n1 | awk '{print $3}' || true)
        if [ -n "$pkg_ver" ]; then
          echo -e "${CYAN}[*] Found safe version: $pkg_ver. Swapping and installing...${NC}"
          if [ "$pkg_name" = "containerd" ]; then
            sudo apt-get remove -y containerd || true
          fi
          sudo apt-get install -y --allow-downgrades containerd.io="$pkg_ver"
          sudo apt-mark hold containerd.io
          sudo systemctl restart docker || true
          echo -e "${GREEN}[✓] containerd.io successfully installed, downgraded, and pinned.${NC}"
        else
          local fallback_ver=$(apt-cache madison containerd.io | grep -oE "1\.7\.28-1~[a-zA-Z0-9\.]+" | head -n1 || true)
          if [ -n "$fallback_ver" ]; then
            if [ "$pkg_name" = "containerd" ]; then
              sudo apt-get remove -y containerd || true
            fi
            sudo apt-get install -y --allow-downgrades containerd.io="$fallback_ver"
            sudo apt-mark hold containerd.io
            sudo systemctl restart docker || true
            echo -e "${GREEN}[✓] containerd.io successfully installed, downgraded, and pinned.${NC}"
          else
            echo -e "${RED}[!] Could not find containerd.io=1.7.28-1 in apt cache. Attempting manual download & install...${NC}"
            # Attempt to download directly from Docker package pool
            local codename=$(lsb_release -cs)
            local dist="ubuntu"
            if [ -f /etc/os-release ] && grep -q -i "debian" /etc/os-release; then
              dist="debian"
            fi
            local arch=$(dpkg --print-architecture)
            
            # Form URL for direct download
            local dl_url="https://download.docker.com/linux/$dist/dists/$codename/pool/stable/$arch/containerd.io_1.7.28-1_amd64.deb"
            if [ "$arch" != "amd64" ]; then
              dl_url="https://download.docker.com/linux/$dist/dists/$codename/pool/stable/$arch/containerd.io_1.7.28-1_$arch.deb"
            fi
            
            echo -e "${CYAN}[*] Downloading from $dl_url ...${NC}"
            if wget -q -O /tmp/containerd.deb "$dl_url"; then
              if [ "$pkg_name" = "containerd" ]; then
                sudo apt-get remove -y containerd || true
              fi
              sudo dpkg -i /tmp/containerd.deb || sudo apt-get install -f -y
              sudo apt-mark hold containerd.io
              sudo systemctl restart docker || true
              echo -e "${GREEN}[✓] containerd.io manually downloaded, installed, and pinned.${NC}"
            else
              echo -e "${RED}[!] Direct download failed. Please enable Nesting features of your LXC container or set AppArmor to unconfined on your host Proxmox server.${NC}"
            fi
          fi
        fi
      fi
    else
      echo -e "${GREEN}[✓] No containerd package detected.${NC}"
    fi
  fi
}

install_docker() {
  print_header "Step 1: Installing Docker & Docker Compose"

  # Update lists
  sudo apt-get update -y

  # Install prerequisites
  sudo apt-get install -y curl gnupg ca-certificates lsb-release

  # Install Docker if not present
  if command_exists docker; then
    echo -e "${GREEN}[✓] Docker is already installed.${NC}"
  else
    echo -e "${CYAN}[*] Installing Docker Engine...${NC}"
    sudo apt-get install -y docker.io
    sudo systemctl enable --now docker
    echo -e "${GREEN}[✓] Docker installed successfully.${NC}"
  fi

  # Install Docker Compose if not present
  if command_exists docker-compose || docker compose version >/dev/null 2>&1; then
    echo -e "${GREEN}[✓] Docker Compose is already installed.${NC}"
  else
    echo -e "${CYAN}[*] Installing Docker Compose...${NC}"
    sudo apt-get install -y docker-compose
    echo -e "${GREEN}[✓] Docker Compose installed successfully.${NC}"
  fi

  # Apply containerd LXC downgrade fix if needed
  check_and_fix_lxc_containerd

  # Configure Docker Group
  if [ -n "$SUDO_USER" ]; then
    CURRENT_USER="$SUDO_USER"
  else
    CURRENT_USER="$USER"
  fi
  
  echo -e "${CYAN}[*] Adding user '$CURRENT_USER' to docker group...${NC}"
  sudo usermod -aG docker "$CURRENT_USER" || true
}

configure_env() {
  print_header "Step 2: Environment Settings Configuration"

  ENV_FILE=".env"
  
  # Default fallback settings
  PORT="3000"
  REDIS_HOST="presto-redis"
  REDIS_PORT="6379"
  MAX_CONCURRENT_BUILDS="3"
  PORT_RANGE_START="10000"
  PORT_RANGE_END="20000"
  WEBHOOK_SECRET=""
  ENCRYPTION_KEY=""

  # Try to read variables from existing .env if present
  if [ -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}[!] An existing .env file was found.${NC}"
    read -rp "Do you want to load its values and keep them as defaults? (Y/n): " load_env
    load_env=${load_env:-Y}
    if [[ "$load_env" =~ ^[Yy]$ ]]; then
      PORT=$(grep -E "^PORT=" "$ENV_FILE" | cut -d'=' -f2- || echo "3000")
      REDIS_HOST=$(grep -E "^REDIS_HOST=" "$ENV_FILE" | cut -d'=' -f2- || echo "presto-redis")
      REDIS_PORT=$(grep -E "^REDIS_PORT=" "$ENV_FILE" | cut -d'=' -f2- || echo "6379")
      MAX_CONCURRENT_BUILDS=$(grep -E "^MAX_CONCURRENT_BUILDS=" "$ENV_FILE" | cut -d'=' -f2- || echo "3")
      PORT_RANGE_START=$(grep -E "^PORT_RANGE_START=" "$ENV_FILE" | cut -d'=' -f2- || echo "10000")
      PORT_RANGE_END=$(grep -E "^PORT_RANGE_END=" "$ENV_FILE" | cut -d'=' -f2- || echo "20000")
      WEBHOOK_SECRET=$(grep -E "^WEBHOOK_SECRET=" "$ENV_FILE" | cut -d'=' -f2- || echo "")
      ENCRYPTION_KEY=$(grep -E "^ENCRYPTION_KEY=" "$ENV_FILE" | cut -d'=' -f2- || echo "")
      echo -e "${GREEN}[✓] Loaded existing defaults from .env.${NC}\n"
    fi
  fi

  echo -e "${CYAN}Please input configuration values (Press [Enter] to use defaults):${NC}\n"

  # Build queue limits
  read -rp "Max Concurrent Builds [Default: $MAX_CONCURRENT_BUILDS]: " input_max_builds
  MAX_CONCURRENT_BUILDS=${input_max_builds:-$MAX_CONCURRENT_BUILDS}

  # Dynamic Port Ranges
  read -rp "Container Allocation Port Start [Default: $PORT_RANGE_START]: " input_port_start
  PORT_RANGE_START=${input_port_start:-$PORT_RANGE_START}
  
  read -rp "Container Allocation Port End [Default: $PORT_RANGE_END]: " input_port_end
  PORT_RANGE_END=${input_port_end:-$PORT_RANGE_END}

  # Secure Keys Generation
  if [ -z "$WEBHOOK_SECRET" ] || [ "$WEBHOOK_SECRET" = "github_webhook_secret_key_here" ]; then
    WEBHOOK_SECRET=$(openssl rand -hex 24 2>/dev/null || tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48)
    echo -e "${YELLOW}[!] Auto-generated secure GitHub Webhook Secret.${NC}"
  fi

  if [ -z "$ENCRYPTION_KEY" ] || [ "$ENCRYPTION_KEY" = "my_secure_32_char_encryption_key_" ] || [ ${#ENCRYPTION_KEY} -ne 32 ]; then
    ENCRYPTION_KEY=$(openssl rand -hex 16 2>/dev/null || tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
    echo -e "${YELLOW}[!] Auto-generated secure 32-character database encryption key.${NC}"
  fi

  # Create directories
  mkdir -p data builds nginx/conf.d

  # Create default nginx server config if not exists
  if [ ! -f "nginx/conf.d/default.conf" ]; then
    cat <<EOF > "nginx/conf.d/default.conf"
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://presto-app:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # WebSockets support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
  fi

  # Create or rewrite .env
  cat <<EOF > "$ENV_FILE"
PORT=$PORT
WEBHOOK_SECRET=$WEBHOOK_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
REDIS_HOST=$REDIS_HOST
REDIS_PORT=$REDIS_PORT
MAX_CONCURRENT_BUILDS=$MAX_CONCURRENT_BUILDS
PORT_RANGE_START=$PORT_RANGE_START
PORT_RANGE_END=$PORT_RANGE_END

# Nginx Configuration
NGINX_CONF_DIR=/app/nginx/conf.d
NGINX_UPSTREAM_HOST=host.docker.internal
NGINX_RELOAD_CMD=docker exec presto-nginx nginx -s reload
EOF

  chmod 600 "$ENV_FILE"
  echo -e "\n${GREEN}[✓] Environment configuration written successfully to $ENV_FILE.${NC}"
}

deploy_docker() {
  print_header "Step 3: Launching PRESTO with Docker Compose"

  echo -e "${CYAN}[*] Starting Docker containers...${NC}"
  if command_exists docker-compose; then
    sudo docker-compose up -d --build
  else
    sudo docker compose up -d --build
  fi

  echo -e "${GREEN}[✓] PRESTO containers are running!${NC}"
}

print_summary() {
  IP_ADDR=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "your-server-ip")
  
  WEBHOOK_SECRET=$(grep -E "^WEBHOOK_SECRET=" .env | cut -d'=' -f2-)
  ENCRYPTION_KEY=$(grep -E "^ENCRYPTION_KEY=" .env | cut -d'=' -f2-)

  print_header "PRESTO PaaS Setup Completed!"
  
  echo -e "${GREEN}${BOLD}Congratulations! PRESTO has been successfully started via Docker.${NC}"
  echo -e "\n${BOLD}----------------- SYSTEM ENDPOINTS -----------------${NC}"
  echo -e "  Dashboard URL:       ${CYAN}${BOLD}http://${IP_ADDR}${NC}"
  echo -e "  Webhook URL:         ${CYAN}${BOLD}http://${IP_ADDR}/webhook/github${NC}"
  echo -e "  Webhook Secret:      ${YELLOW}${WEBHOOK_SECRET}${NC}"
  echo -e "  DB Encryption Key:   ${YELLOW}${ENCRYPTION_KEY}${NC}"
  echo -e "${BOLD}----------------------------------------------------${NC}"
  echo -e "\n${GREEN}PRESTO PaaS Engine is now running and ready!${NC}\n"
}

main() {
  print_banner
  check_system
  install_docker
  configure_env
  deploy_docker
  print_summary
}

main
