#!/usr/bin/env bash
set -euo pipefail

# Claude Code Telegram — Uninstaller

INSTALL_DIR="$HOME/.claude-telegram-bot"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}ℹ${NC}  $1"; }
ok()    { echo -e "${GREEN}✔${NC}  $1"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $1"; }

echo ""
echo -e "${BOLD}Claude Code Telegram — Uninstaller${NC}"
echo ""

read -rp "This will stop the bot and remove $INSTALL_DIR. Continue? [y/N] " CONFIRM
if [[ ! "${CONFIRM:-N}" =~ ^[Yy]$ ]]; then
  echo "Cancelled."
  exit 0
fi

# Stop PM2 process
if command -v pm2 &>/dev/null; then
  info "Stopping PM2 process..."
  pm2 delete claude-telegram-bot 2>/dev/null && ok "PM2 process removed" || info "No PM2 process found"
  pm2 save 2>/dev/null || true
fi

# Remove install directory
if [ -d "$INSTALL_DIR" ]; then
  info "Removing $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR"
  ok "Installation directory removed"
else
  info "No installation directory found"
fi

echo ""
ok "Uninstall complete"
echo ""
