#!/usr/bin/env bash
set -euo pipefail

# Claude Code Telegram — One-command installer
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR_USER/claude-code-telegram/main/install.sh | bash

REPO_URL="https://github.com/gididaf/claude-code-telegram.git"
INSTALL_DIR="$HOME/.claude-telegram-bot"
MIN_NODE_VERSION=18

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}ℹ${NC}  $1"; }
ok()    { echo -e "${GREEN}✔${NC}  $1"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $1"; }
fail()  { echo -e "${RED}✖${NC}  $1"; exit 1; }

echo ""
echo -e "${BOLD}╔════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   Claude Code Telegram — Installer     ║${NC}"
echo -e "${BOLD}╚════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Check Node.js ──────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js >= $MIN_NODE_VERSION first.\n   Recommended: https://github.com/nvm-sh/nvm"
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt "$MIN_NODE_VERSION" ]; then
  fail "Node.js v$NODE_MAJOR found, but v$MIN_NODE_VERSION+ is required.\n   Run: nvm install --lts"
fi
ok "Node.js v$(node -v | tr -d v) detected"

# ── 2. Check npm ──────────────────────────────────────────────────

if ! command -v npm &>/dev/null; then
  fail "npm not found. It should come with Node.js."
fi
ok "npm $(npm -v) detected"

# ── 3. Check Claude CLI ──────────────────────────────────────────

if command -v claude &>/dev/null; then
  ok "Claude CLI found at $(which claude)"
else
  warn "Claude CLI not found in PATH. You can set CLAUDE_CLI_PATH in .env later."
fi

# ── 4. Install PM2 if needed ─────────────────────────────────────

if command -v pm2 &>/dev/null; then
  ok "PM2 already installed"
else
  info "Installing PM2 globally..."
  npm install -g pm2 || fail "Failed to install PM2. Try: sudo npm install -g pm2"
  ok "PM2 installed"
fi

# ── 5. Clone or update repo ──────────────────────────────────────

if [ -d "$INSTALL_DIR" ]; then
  warn "Existing installation found at $INSTALL_DIR"
  echo ""
  read -rp "   Update existing installation? [Y/n] " UPDATE_CHOICE
  if [[ "${UPDATE_CHOICE:-Y}" =~ ^[Yy]?$ ]]; then
    info "Updating..."
    cd "$INSTALL_DIR"
    git pull --ff-only || fail "Git pull failed. Resolve conflicts manually in $INSTALL_DIR"
    ok "Repository updated"
  else
    info "Keeping existing code"
    cd "$INSTALL_DIR"
  fi
else
  info "Cloning repository to $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR" || fail "Failed to clone repository"
  cd "$INSTALL_DIR"
  ok "Repository cloned"
fi

# ── 6. Install dependencies & build ──────────────────────────────

info "Installing dependencies..."
npm install --production=false || fail "npm install failed"
ok "Dependencies installed"

info "Building TypeScript..."
npm run build || fail "Build failed"
ok "Build complete"

# ── 7. Configure .env ────────────────────────────────────────────

if [ -f "$INSTALL_DIR/.env" ]; then
  ok "Existing .env found — keeping current configuration"
  echo ""
  read -rp "   Reconfigure? [y/N] " RECONFIG
  if [[ ! "${RECONFIG:-N}" =~ ^[Yy]$ ]]; then
    SKIP_CONFIG=true
  fi
fi

if [ "${SKIP_CONFIG:-false}" != "true" ]; then
  echo ""
  echo -e "${BOLD}── Configuration ──${NC}"
  echo ""
  echo "  You'll need:"
  echo "  1. A Telegram bot token (create one at @BotFather)"
  echo "  2. Your Telegram user ID (message @userinfobot to get it)"
  echo ""

  # Bot token
  while true; do
    read -rp "  Telegram Bot Token: " BOT_TOKEN
    if [ -n "$BOT_TOKEN" ]; then break; fi
    echo "  Token is required."
  done

  # User ID
  while true; do
    read -rp "  Telegram User ID: " USER_ID
    if [[ "$USER_ID" =~ ^[0-9]+$ ]]; then break; fi
    echo "  User ID must be a number."
  done

  # Write .env
  cat > "$INSTALL_DIR/.env" << EOF
TELEGRAM_BOT_TOKEN=$BOT_TOKEN
TELEGRAM_USER_ID=$USER_ID
EOF

  ok "Configuration saved to $INSTALL_DIR/.env"
fi

# ── 8. PM2 setup ─────────────────────────────────────────────────

echo ""
info "Setting up PM2 service..."

# Stop existing instance if running
pm2 delete claude-telegram-bot 2>/dev/null || true

cd "$INSTALL_DIR"
pm2 start ecosystem.config.cjs || fail "PM2 failed to start the bot"
pm2 save || warn "pm2 save failed — the bot may not survive a reboot"
ok "Bot started with PM2"

# Try to set up startup (non-fatal if it fails)
echo ""
info "Setting up auto-start on boot..."
PM2_STARTUP_CMD=$(pm2 startup 2>/dev/null | grep "sudo" | head -1) || true
if [ -n "$PM2_STARTUP_CMD" ]; then
  echo ""
  echo -e "  ${YELLOW}Run this command to enable auto-start on boot:${NC}"
  echo ""
  echo "    $PM2_STARTUP_CMD"
  echo ""
else
  ok "PM2 startup already configured"
fi

# ── Done ──────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Installation complete!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════${NC}"
echo ""
echo "  Your bot is now running. Open Telegram and message it!"
echo ""
echo "  Useful commands:"
echo "    pm2 logs claude-telegram-bot    — View logs"
echo "    pm2 restart claude-telegram-bot — Restart bot"
echo "    pm2 stop claude-telegram-bot    — Stop bot"
echo ""
echo "  Installation directory: $INSTALL_DIR"
echo "  Configuration file:     $INSTALL_DIR/.env"
echo ""
