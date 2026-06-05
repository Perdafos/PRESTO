#!/usr/bin/env bash

# PRESTO PaaS Deployment Engine - Interactive Server Setup Wizard
# Copyright (c) 2026 Perdafos. All rights reserved.

set -e # Exit immediately if a command exits with a non-zero status

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Helper for headers
print_header() {
  echo -e "\n${MAGENTA}${BOLD}======================================================================${NC}"
  echo -e "${MAGENTA}${BOLD}  $1${NC}"
  echo -e "${MAGENTA}${BOLD}======================================================================${NC}"
}

# Helper to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Print Setup Banner
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
  echo -e "${BOLD}         PaaS Deployment Engine Server Setup Wizard${NC}"
  echo -e "   --------------------------------------------------------"
  echo -e "   This script configures, installs, and runs PRESTO on your"
  echo -e "   Ubuntu/Debian server for a production-ready deployment."
  echo -e "   --------------------------------------------------------"
}

# Install Node.js LTS (v20) via NodeSource
install_node() {
  echo -e "${CYAN}[*] Adding NodeSource Node.js v20 repository...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  echo -e "${CYAN}[*] Installing Node.js...${NC}"
  sudo apt-get install -y nodejs
  echo -e "${GREEN}[✓] Node.js $(node -v) and NPM $(npm -v) installed successfully.${NC}"
}

# Check OS and permissions
check_system() {
  print_header "System Compatibility Check"
  
  # Check if running on Linux
  if [ "$(uname)" != "Linux" ]; then
    echo -e "${RED}[✗] Error: This installer is intended for Linux servers (Ubuntu/Debian).${NC}"
    echo -e "${YELLOW}[!] Current OS: $(uname). Please install prerequisites manually.${NC}"
    read -rp "Do you want to force continue anyway? (y/N): " force_continue
    if [[ ! "$force_continue" =~ ^[Yy]$ ]]; then
      exit 1
    fi
  else
    echo -e "${GREEN}[✓] OS: Linux ($(uname -sr))${NC}"
  fi

  # Check if apt-get is available
  if ! command_exists apt-get; then
    echo -e "${RED}[✗] Error: 'apt' package manager not found. This script requires a Debian/Ubuntu-based OS.${NC}"
    read -rp "Force continue? (y/N): " force_continue
    if [[ ! "$force_continue" =~ ^[Yy]$ ]]; then
      exit 1
    fi
  else
    echo -e "${GREEN}[✓] Package Manager: apt-get detected${NC}"
  fi

  # Check if user has sudo privileges
  if [ "$EUID" -ne 0 ]; then
    if command_exists sudo; then
      if sudo -n true 2>/dev/null; then
        echo -e "${GREEN}[✓] Privilege: User has sudo access.${NC}"
      else
        echo -e "${YELLOW}[!] Privilege: This script needs root/sudo access to install dependencies.${NC}"
        echo -e "    You may be prompted for your password during installation."
      fi
    else
      echo -e "${RED}[✗] Error: Script must be run as root or with sudo, but 'sudo' is not installed.${NC}"
      exit 1
    fi
  else
    echo -e "${GREEN}[✓] Privilege: Running as root.${NC}"
  fi
}

# Step 1: Install System Prerequisites
install_prerequisites() {
  print_header "Step 1: Installing System Prerequisites"

  echo -e "${CYAN}[*] Updating apt package lists...${NC}"
  sudo apt-get update -y

  echo -e "${CYAN}[*] Installing common dependencies...${NC}"
  sudo apt-get install -y curl gnupg2 ca-certificates lsb-release git unzip wget

  # Node.js Check
  if command_exists node; then
    NODE_VERSION=$(node -v | cut -d'v' -f2)
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
      echo -e "${GREEN}[✓] Node.js is already installed (v$NODE_VERSION).${NC}"
    else
      echo -e "${YELLOW}[!] Node.js version is v$NODE_VERSION. Version >= 18 is recommended.${NC}"
      install_node
    fi
  else
    install_node
  fi

  # Redis Check
  if command_exists redis-server; then
    echo -e "${GREEN}[✓] Redis server is already installed.${NC}"
  else
    echo -e "${CYAN}[*] Installing Redis server (required for BullMQ queue in production)...${NC}"
    sudo apt-get install -y redis-server
    echo -e "${CYAN}[*] Starting and enabling Redis service...${NC}"
    sudo systemctl enable --now redis-server
    echo -e "${GREEN}[✓] Redis server installed and running.${NC}"
  fi

  # Docker Check
  if command_exists docker; then
    echo -e "${GREEN}[✓] Docker is already installed (v$(docker --version | awk '{print $3}' | sed 's/,//')).${NC}"
  else
    echo -e "${CYAN}[*] Installing Docker Engine (required for builds and containers)...${NC}"
    sudo apt-get install -y docker.io
    echo -e "${CYAN}[*] Starting and enabling Docker service...${NC}"
    sudo systemctl enable --now docker
    echo -e "${GREEN}[✓] Docker installed and running.${NC}"
  fi

  # Configure Docker Group
  if [ -n "$SUDO_USER" ]; then
    CURRENT_USER="$SUDO_USER"
  else
    CURRENT_USER="$USER"
  fi
  
  echo -e "${CYAN}[*] Adding user '$CURRENT_USER' to docker group...${NC}"
  sudo usermod -aG docker "$CURRENT_USER"
  
  echo -e "${CYAN}[*] Creating Docker bridge network 'paas_network' for PRESTO deployments...${NC}"
  sudo docker network create paas_network 2>/dev/null || true

  # Caddy Check
  if command_exists caddy; then
    echo -e "${GREEN}[✓] Caddy is already installed (v$(caddy version | awk '{print $1}')).${NC}"
  else
    echo -e "${CYAN}[*] Adding Caddy official Debian/Ubuntu repository...${NC}"
    sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    sudo apt-get update -y
    echo -e "${CYAN}[*] Installing Caddy server...${NC}"
    sudo apt-get install -y caddy
    echo -e "${CYAN}[*] Starting and enabling Caddy service...${NC}"
    sudo systemctl enable --now caddy
    echo -e "${GREEN}[✓] Caddy installed and running.${NC}"
  fi

  # PM2 Check
  if command_exists pm2; then
    echo -e "${GREEN}[✓] PM2 is already installed globally.${NC}"
  else
    echo -e "${CYAN}[*] Installing PM2 process manager globally...${NC}"
    if [ "$EUID" -eq 0 ]; then
      npm install -g pm2
    else
      if sudo command -v npm >/dev/null 2>&1; then
        sudo npm install -g pm2
      else
        sudo env "PATH=$PATH" npm install -g pm2
      fi
    fi
    echo -e "${GREEN}[✓] PM2 installed successfully.${NC}"
  fi
  
  echo -e "\n${GREEN}[✓] All system prerequisites are successfully installed!${NC}"
}

# Step 2: Configure Environment Settings (.env)
configure_env() {
  print_header "Step 2: Environment Settings Configuration"

  ENV_FILE=".env"
  
  # Default fallback settings
  PORT="3000"
  SIMULATION_MODE="false"
  REDIS_HOST="127.0.0.1"
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
      # Source or parse file manually to avoid execution of arbitrary code
      PORT=$(grep -E "^PORT=" "$ENV_FILE" | cut -d'=' -f2- || echo "3000")
      SIMULATION_MODE=$(grep -E "^SIMULATION_MODE=" "$ENV_FILE" | cut -d'=' -f2- || echo "false")
      REDIS_HOST=$(grep -E "^REDIS_HOST=" "$ENV_FILE" | cut -d'=' -f2- || echo "127.0.0.1")
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

  # Port
  read -rp "PRESTO Dashboard Port [Default: $PORT]: " input_port
  PORT=${input_port:-$PORT}

  # Simulation mode
  read -rp "Use Simulation Mode? (true/false) [Default: $SIMULATION_MODE]: " input_sim
  SIMULATION_MODE=${input_sim:-$SIMULATION_MODE}

  # Redis settings
  read -rp "Redis Host [Default: $REDIS_HOST]: " input_redis_host
  REDIS_HOST=${input_redis_host:-$REDIS_HOST}
  
  read -rp "Redis Port [Default: $REDIS_PORT]: " input_redis_port
  REDIS_PORT=${input_redis_port:-$REDIS_PORT}

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

  # Create or rewrite .env
  cat <<EOF > "$ENV_FILE"
# PRESTO PaaS Deployment Engine Environment Configuration
PORT=$PORT
WEBHOOK_SECRET=$WEBHOOK_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
SIMULATION_MODE=$SIMULATION_MODE
REDIS_HOST=$REDIS_HOST
REDIS_PORT=$REDIS_PORT
MAX_CONCURRENT_BUILDS=$MAX_CONCURRENT_BUILDS
PORT_RANGE_START=$PORT_RANGE_START
PORT_RANGE_END=$PORT_RANGE_END
EOF

  chmod 600 "$ENV_FILE"
  echo -e "\n${GREEN}[✓] Environment configuration written successfully to $ENV_FILE.${NC}"
}

# Step 3: Install Project Dependencies and Build
build_project() {
  print_header "Step 3: Building PRESTO Application"

  echo -e "${CYAN}[*] Installing Node packages...${NC}"
  npm install

  echo -e "${CYAN}[*] Compiling frontend & backend code...${NC}"
  npm run build

  if [ ! -d "dist" ]; then
    echo -e "${RED}[✗] Error: Build failed! 'dist' folder was not created.${NC}"
    exit 1
  fi
  
  echo -e "${GREEN}[✓] PRESTO built successfully!${NC}"
}

# Step 4: Run Application via PM2
deploy_app() {
  print_header "Step 4: Launching Application with PM2"

  if ! command_exists pm2; then
    echo -e "${RED}[✗] PM2 is not installed! Installing globally...${NC}"
    sudo npm install -g pm2
  fi

  # Check if process is already running in PM2
  if pm2 show paas-engine >/dev/null 2>&1; then
    echo -e "${CYAN}[*] 'paas-engine' is already registered in PM2. Restarting...${NC}"
    pm2 restart paas-engine
  else
    echo -e "${CYAN}[*] Launching new instance of PRESTO via PM2...${NC}"
    pm2 start dist/index.js --name paas-engine
  fi

  echo -e "${CYAN}[*] Saving PM2 state...${NC}"
  pm2 save

  echo -e "\n${GREEN}[✓] PRESTO process is running in the background via PM2!${NC}"
  pm2 status paas-engine
}

# Configure Caddy Reverse Proxy for a custom domain
configure_caddy() {
  local port="$1"
  print_header "Caddy Reverse Proxy Setup"

  read -rp "Enter the domain name for your PRESTO dashboard (e.g., presto.mycompany.com): " caddy_domain
  if [ -z "$caddy_domain" ]; then
    echo -e "${RED}[✗] No domain provided. Skipping Caddy routing config.${NC}"
    return
  fi

  echo -e "${CYAN}[*] Configuring Caddy to proxy https://$caddy_domain -> http://localhost:$port...${NC}"

  # Backup Caddyfile
  if [ -f "/etc/caddy/Caddyfile" ]; then
    sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak
  fi

  # Write configuration block
  if grep -q "$caddy_domain" /etc/caddy/Caddyfile 2>/dev/null; then
    echo -e "${YELLOW}[!] A config block for $caddy_domain already exists. Skipping append.${NC}"
  else
    sudo tee -a /etc/caddy/Caddyfile > /dev/null <<EOF

# PRESTO Dashboard Reverse Proxy
$caddy_domain {
    reverse_proxy localhost:$port
}
EOF
    echo -e "${GREEN}[✓] Appended proxy rule to /etc/caddy/Caddyfile.${NC}"
  fi

  echo -e "${CYAN}[*] Reloading Caddy...${NC}"
  sudo systemctl reload caddy || sudo systemctl restart caddy
  echo -e "${GREEN}[✓] Caddy proxy successfully updated and reloaded!${NC}"
  
  EXPOSE_DOMAIN="https://$caddy_domain"
}

# Install and configure Cloudflare Tunnel (cloudflared)
configure_cloudflare_tunnel() {
  local port="$1"
  print_header "Cloudflare Tunnel (cloudflared) Setup"

  echo -e "Cloudflare Tunnel allows you to expose your local PRESTO dashboard and apps"
  echo -e "securely to the internet without opening firewall ports or using public IPs."
  echo
  echo -e "Step to get a token:"
  echo -e " 1. Go to Cloudflare Zero Trust Dashboard (https://one.dash.cloudflare.com/)"
  echo -e " 2. Navigate to Networks -> Tunnels -> Add a Tunnel"
  echo -e " 3. Copy the 'Token' string from the command Cloudflare provides you."
  echo

  read -rp "Enter your Cloudflare Tunnel Token: " tunnel_token
  if [ -z "$tunnel_token" ]; then
    echo -e "${RED}[✗] No token provided. Skipping Cloudflare Tunnel setup.${NC}"
    return
  fi

  # Install cloudflared if not present
  if ! command_exists cloudflared; then
    echo -e "${CYAN}[*] Installing Cloudflare Tunnel client (cloudflared)...${NC}"
    sudo mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared debian-stable main' | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
    sudo apt-get update -y
    sudo apt-get install -y cloudflared
    echo -e "${GREEN}[✓] cloudflared installed successfully.${NC}"
  fi

  echo -e "${CYAN}[*] Registering cloudflared system service...${NC}"
  
  # Uninstall service if it exists to avoid衝突
  if systemctl is-active --quiet cloudflared 2>/dev/null; then
    sudo systemctl stop cloudflared || true
    sudo cloudflared service uninstall 2>/dev/null || true
  fi

  sudo cloudflared service install "$tunnel_token"
  
  echo -e "${CYAN}[*] Enabling and starting cloudflared...${NC}"
  sudo systemctl daemon-reload
  sudo systemctl enable --now cloudflared

  echo -e "${GREEN}[✓] Cloudflare Tunnel service is installed and running!${NC}"
  echo -e "${YELLOW}[!] Make sure you map a hostname (e.g. presto.domain.com) to service 'http://localhost:$port' in Cloudflare Zero Trust.${NC}"
  
  EXPOSE_TUNNEL="Active (Check your Cloudflare Zero Trust panel for status)"
}

# Prompt user for Expose / Routing mode
setup_expose_mode() {
  print_header "Dashboard Exposure & Routing Options"
  
  # Read PORT from .env
  local port="3000"
  if [ -f ".env" ]; then
    port=$(grep -E "^PORT=" .env | cut -d'=' -f2- || echo "3000")
  fi

  echo -e "Choose how you want to expose and access the PRESTO Dashboard:"
  echo -e "  [1] Direct Port Access (Access via http://<server-ip>:$port)"
  echo -e "  [2] Caddy Reverse Proxy (Access via https://your-domain.com with automatic SSL)"
  echo -e "  [3] Cloudflare Tunnel (Expose securely through cloudflared Tunnel Token)"
  echo -e "  [4] Skip Expose Setup"
  echo
  read -rp "Enter choice [1-4]: " expose_choice

  case "$expose_choice" in
    1)
      # Direct port
      IP_ADDR=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "your-server-ip")
      EXPOSE_DOMAIN="http://$IP_ADDR:$port"
      ;;
    2)
      configure_caddy "$port"
      ;;
    3)
      configure_cloudflare_tunnel "$port"
      ;;
    *)
      echo -e "${YELLOW}[!] Expose setup skipped. Dashboard port is $port.${NC}"
      ;;
  esac
}

# Final Summary Dashboard
print_summary() {
  # Retrieve local IP
  IP_ADDR=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "your-server-ip")
  
  # Read settings from .env
  PORT=$(grep -E "^PORT=" .env | cut -d'=' -f2- || echo "3000")
  WEBHOOK_SECRET=$(grep -E "^WEBHOOK_SECRET=" .env | cut -d'=' -f2- || echo "")
  ENCRYPTION_KEY=$(grep -E "^ENCRYPTION_KEY=" .env | cut -d'=' -f2- || echo "")

  print_header "PRESTO PaaS Setup Completed!"
  
  echo -e "${GREEN}${BOLD}Congratulations! PRESTO has been successfully set up and is running.${NC}"
  echo -e "\n${BOLD}----------------- SYSTEM ENDPOINTS -----------------${NC}"
  if [ -n "$EXPOSE_DOMAIN" ]; then
    echo -e "  Dashboard URL:       ${CYAN}${BOLD}${EXPOSE_DOMAIN}${NC}"
  else
    echo -e "  Dashboard URL:       ${CYAN}${BOLD}http://${IP_ADDR}:${PORT}${NC}"
  fi
  
  if [ -n "$EXPOSE_TUNNEL" ]; then
    echo -e "  Cloudflare Tunnel:   ${GREEN}${BOLD}${EXPOSE_TUNNEL}${NC}"
  fi
  
  echo -e "  Webhook URL:         ${CYAN}${BOLD}http://${IP_ADDR}:${PORT}/webhook/github${NC}"
  echo -e "  Webhook Secret:      ${YELLOW}${WEBHOOK_SECRET}${NC}"
  echo -e "  DB Encryption Key:   ${YELLOW}${ENCRYPTION_KEY}${NC}"
  echo -e "${BOLD}----------------------------------------------------${NC}"
  
  echo -e "\n${BOLD}Required Manual Post-install Steps & Tips:${NC}"
  echo -e " 1. ${YELLOW}Docker Permissions:${NC} Run ${CYAN}newgrp docker${NC} or log out and back in"
  echo -e "    for your user to execute docker commands without sudo."
  echo -e " 2. ${YELLOW}Automatic Boot Persistence:${NC} Run the following command to configure"
  echo -e "    PM2 startup behavior on server restart:"
  echo -e "    ${CYAN}pm2 startup${NC}"
  echo -e "    (Then copy/paste the command printed by PM2 into your terminal)"
  
  if [ -n "$EXPOSE_TUNNEL" ]; then
    echo -e " 3. ${YELLOW}Cloudflare Tunnel for Sub-projects:${NC}"
    echo -e "    If you want your deployed apps (e.g. *.yourdomain.com) also tunneled,"
    echo -e "    create a wildcard hostname rule in the Cloudflare Zero Trust Dashboard:"
    echo -e "      - Hostname: ${CYAN}*.yourdomain.com${NC}"
    echo -e "      - Service: ${CYAN}http://localhost:80${NC} (points to Caddy, which routes them dynamically!)"
  fi
  
  echo -e "\n${GREEN}PRESTO PaaS Engine is now ready to host your code!${NC}\n"
}

# Main menu loop
main_menu() {
  while true; do
    print_banner
    echo -e " Please select an option:"
    echo -e "  [1] ${GREEN}${BOLD}Full Automated Installation (Recommended)${NC}"
    echo -e "      (Install prerequisites, configure .env, build project, configure expose, and deploy PM2)"
    echo -e "  [2] Install System Prerequisites Only"
    echo -e "  [3] Configure/Generate .env Only"
    echo -e "  [4] Expose & Routing Configuration (Caddy / Cloudflare Tunnel)"
    echo -e "  [5] Compile and Deploy/Restart Application Only"
    echo -e "  [6] Exit Setup"
    echo
    read -rp " Enter option [1-6]: " option

    case "$option" in
      1)
        check_system
        install_prerequisites
        configure_env
        build_project
        setup_expose_mode
        deploy_app
        print_summary
        break
        ;;
      2)
        check_system
        install_prerequisites
        read -n 1 -s -r -p "Prerequisites installed. Press any key to return to menu..."
        ;;
      3)
        configure_env
        read -n 1 -s -r -p "Configuration saved. Press any key to return to menu..."
        ;;
      4)
        setup_expose_mode
        read -n 1 -s -r -p "Expose settings configured. Press any key to return to menu..."
        ;;
      5)
        build_project
        deploy_app
        read -n 1 -s -r -p "Application compiled and deployed. Press any key to return to menu..."
        ;;
      6)
        echo -e "\n${YELLOW}Exiting Setup Wizard. Goodbye!${NC}\n"
        exit 0
        ;;
      *)
        echo -e "\n${RED}[✗] Invalid option, please select 1 to 6.${NC}"
        sleep 1.5
        ;;
    esac
  done
}

# Run the wizard
main_menu
