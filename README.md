# Claude Code Telegram

Control [Claude Code](https://docs.anthropic.com/en/docs/claude-code) from your phone via Telegram.

Browse your existing projects and sessions, start new ones, and chat with Claude Code — all with live-streaming responses that update in real-time.

## Features

- **Live streaming** — responses update in real-time as Claude thinks and writes
- **Project browser** — browse all your existing Claude Code projects with inline keyboards
- **Session management** — resume previous sessions or start fresh ones
- **Tool indicators** — see what Claude is doing (`Bash: npm test`, `Read: src/index.ts`, etc.)
- **Directory browser** — create new projects by navigating your filesystem
- **Folder creation** — create new directories right from Telegram
- **Auto-splitting** — long responses automatically split across multiple messages
- **Single-user** — secured by your Telegram user ID
- **Runs as a service** — PM2 keeps it running and auto-restarts on crash/reboot

## Prerequisites

- **Node.js 18+** — [install via nvm](https://github.com/nvm-sh/nvm)
- **Claude Code CLI** — [install instructions](https://docs.anthropic.com/en/docs/claude-code)
- **Telegram bot token** — create one via [@BotFather](https://t.me/BotFather)
- **Your Telegram user ID** — get it from [@userinfobot](https://t.me/userinfobot)

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/gididaf/claude-code-telegram/main/install.sh | bash
```

The installer will:
1. Check Node.js and npm are available
2. Install PM2 globally (if needed)
3. Clone the repo to `~/.claude-telegram-bot/`
4. Install dependencies and build
5. Prompt you for your bot token and user ID
6. Start the bot as a background service

## Manual Install

```bash
git clone https://github.com/gididaf/claude-code-telegram.git
cd claude-code-telegram
npm install
npm run build

# Configure
cp .env.example .env
# Edit .env with your bot token and user ID

# Run directly
npm start

# Or with PM2
pm2 start ecosystem.config.cjs
pm2 save
```

## Configuration

Edit `.env` (or `~/.claude-telegram-bot/.env` if installed via the script):

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_USER_ID` | Yes | Your numeric Telegram user ID |
| `CLAUDE_CLI_PATH` | No | Path to `claude` CLI (default: `claude` from PATH) |
| `DEFAULT_PROJECT_PATH` | No | Auto-select this project on startup |
| `STREAM_UPDATE_INTERVAL_MS` | No | How often to update streaming messages (default: `2500`) |
| `PROCESS_TIMEOUT_MS` | No | Max time for a Claude request (default: `300000`) |

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message |
| `/projects` | Browse and switch projects |
| `/session` | Switch or start sessions in current project |
| `/new` | Create a new project from a directory |
| `/cancel` | Cancel a running request |
| `/status` | Show current state |

### Workflow

1. **Select a project** — use `/projects` to browse your existing Claude Code projects, or `/new` to pick a directory
2. **Pick a session** — resume a previous conversation or start fresh
3. **Chat** — just type your message. Claude's response streams back in real-time
4. **Switch context** — use `/projects` or `/session` anytime to change what you're working on

## How It Works

The bot spawns the Claude Code CLI with `--output-format stream-json` and parses the streaming JSON output. Each token delta updates the Telegram message in real-time (debounced to ~2.5s to respect rate limits).

```
You type a message in Telegram
  → Bot spawns: claude -p "your message" --output-format stream-json ...
  → Stream events arrive (text deltas, tool use, results)
  → Telegram message updates live as tokens stream in
  → Final formatted response when complete
```

Sessions are real Claude Code sessions stored in `~/.claude/projects/`. You can continue them from the CLI too.

## PM2 Commands

```bash
pm2 logs claude-telegram-bot      # View logs
pm2 restart claude-telegram-bot   # Restart
pm2 stop claude-telegram-bot      # Stop
pm2 delete claude-telegram-bot    # Remove
```

## Updating

If installed via the script, run the installer again — it will pull the latest code and rebuild:

```bash
curl -fsSL https://raw.githubusercontent.com/gididaf/claude-code-telegram/main/install.sh | bash
```

Or manually:

```bash
cd ~/.claude-telegram-bot
git pull
npm install
npm run build
pm2 restart claude-telegram-bot
```

## License

MIT
