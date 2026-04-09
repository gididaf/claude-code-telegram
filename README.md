<h1 align="center">Claude Code Telegram</h1>

<p align="center">
  <strong>Control Claude Code from your phone. Full IDE power, zero terminal.</strong>
</p>

<p align="center">
  <a href="#-quick-install">Quick Install</a> &bull;
  <a href="#-features">Features</a> &bull;
  <a href="#-commands">Commands</a> &bull;
  <a href="#%EF%B8%8F-configuration">Configuration</a>
</p>

---

A Telegram bot that gives you **complete control** over [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) from anywhere. Browse projects, manage sessions, execute commands, review plans — all through Telegram's native UI with live-streaming responses and inline keyboards.

Unlike simple relay bots, this is a **full-featured remote control**: session history with rewind, plan mode with implement/refine workflow, interactive question handling, message queuing, and real-time tool indicators that show exactly what Claude is doing.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/gididaf/claude-code-telegram/main/install.sh | bash
```

The installer checks prerequisites, clones the repo, builds, prompts for your bot token + user ID, and starts everything with PM2. Done in under a minute.

<details>
<summary><strong>Manual install</strong></summary>

```bash
git clone https://github.com/gididaf/claude-code-telegram.git
cd claude-code-telegram
npm install && npm run build

cp .env.example .env
# Edit .env with your bot token and user ID

npm start
# Or with PM2: pm2 start ecosystem.config.cjs && pm2 save
```

</details>

### Prerequisites

- **Node.js 18+** — [install via nvm](https://github.com/nvm-sh/nvm)
- **Claude Code CLI** — [install instructions](https://docs.anthropic.com/en/docs/claude-code)
- **Telegram bot token** — create via [@BotFather](https://t.me/BotFather)
- **Your Telegram user ID** — get from [@userinfobot](https://t.me/userinfobot)

## Features

### Live Streaming Responses

Responses update in real-time as Claude thinks and writes. Messages are debounced to respect Telegram's rate limits and automatically split across multiple messages when they exceed Telegram's 4096-character limit. Markdown is converted to Telegram-safe HTML with code blocks, inline code, bold, italic, and headers.

### Real-Time Tool Indicators

See exactly what Claude is doing as it works:

```
🔧 Bash: npm test
🔧 Read: src/index.ts
🔧 Edit: src/handlers/chat.ts
🔧 Grep: handleChat
🔧 Agent: Fix failing tests
```

When a tool completes, indicators update in-place:

```
✅ Bash: npm test (47 lines)
✅ Read: src/index.ts (24 lines)
❌ Edit: src/handlers/chat.ts (error)
```

File paths are automatically shortened — `/Users/you/projects/app/src/index.ts` becomes `src/index.ts`.

### Project & Session Management

- **Browse all projects** — paginated inline keyboards showing your Claude Code projects with session counts
- **Resume any session** — pick up exactly where you left off, with full context preserved
- **Start fresh sessions** — new conversation in the current project
- **Session metadata** — message count, timestamps, git branch, first prompt preview

### Session History & Rewind

Browse the full conversation history of any session, filtered to show only meaningful exchanges (user prompts and Claude responses — no tool noise). **Rewind to any previous Claude message** to branch the conversation from that point. The session is truncated in-place, so when you resume, Claude has the full history up to that point.

### Plan Mode

Claude can create structured plans using plan mode. When a plan is created, you get action buttons:

- **Implement** — tells Claude to execute the plan
- **View Plan** — displays the full plan in Telegram
- **Refine** — prompts you for feedback to iterate on the plan

Plans are stored as Markdown files and persist across sessions.

### Interactive Question Handling

When Claude asks questions (via `AskUserQuestion`), they appear as native Telegram inline keyboards:

- **Single-select** — tap an option to answer immediately
- **Multi-select** — toggle options with checkboxes, then submit
- **Free text** — type a custom answer instead of selecting
- **Mixed mode** — select options AND add custom text
- **Sequential questions** — multiple questions shown one at a time

### Message Queue

Send messages while Claude is busy — they queue automatically. The latest message wins (single-slot queue), displayed with a cancel button. When Claude finishes, the queued message fires immediately. No waiting, no lost messages.

### Inline Cancel

Every streaming response includes a **Cancel** button. Cancellation uses SIGINT for graceful shutdown — Claude saves the interrupted turn to the session file, preserving full context. Escalates to SIGTERM/SIGKILL if needed. After cancel, any queued message auto-processes.

### Direct Shell Access

Run shell commands directly with `/bash` — no Claude involved. 30-second timeout, output displayed in a formatted code block. Great for quick `git status`, `ls`, or `npm test` checks.

### Directory Browser

Create new projects by navigating your filesystem through Telegram. Paginated directory listings, parent navigation, and **inline folder creation** — all working within Telegram's 64-byte callback data limit via an in-memory path cache.

### Context Usage Tracking

Every response shows context window usage and execution time:

```
📊 12.4% context | ⏱ 8.3s
```

Calculated from the CLI's model usage data — input tokens, output tokens, cache reads, and cache creation relative to the model's context window.

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message with quick-action keyboard |
| `/projects` | Browse and switch between Claude Code projects |
| `/resume` | List sessions in the current project to resume |
| `/new` | Start a new session in the current project |
| `/rewind` | View session history and rewind to any message |
| `/status` | Show current project, session, and processing state |
| `/bash <cmd>` | Run a shell command directly (30s timeout) |
| `/plan` | View the current plan with implement/refine buttons |

Just **type a message** to chat with Claude. Responses stream back in real-time.

## How It Works

```
You type a message in Telegram
  → Bot spawns: claude -p "message" --output-format stream-json --verbose
  → Stream events parsed line-by-line (init, text-delta, tool-use, tool-result, result)
  → Telegram message edited live every ~2.5s as tokens arrive
  → Tools shown as 🔧 indicators, updated to ✅/❌ on completion
  → Final response formatted as HTML, auto-split if needed
  → Queue drains automatically if messages are waiting
```

Sessions are real Claude Code sessions stored in `~/.claude/projects/`. You can continue them from the CLI or from Telegram interchangeably.

**Stack:** TypeScript, Node.js (ESM), [grammY](https://grammy.dev/), PM2. Single-user, single-process. No database — all state is in-memory.

## Configuration

Edit `.env` (or `~/.claude-telegram-bot/.env` if installed via the script):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from @BotFather |
| `TELEGRAM_USER_ID` | Yes | — | Your numeric Telegram user ID |
| `CLAUDE_CLI_PATH` | No | `claude` | Path to the Claude CLI binary |
| `DEFAULT_PROJECT_PATH` | No | — | Auto-select this project on startup |
| `STREAM_UPDATE_INTERVAL_MS` | No | `2500` | Live edit frequency in ms |
| `PROCESS_TIMEOUT_MS` | No | `300000` | Max time per Claude request (5 min) |

## PM2 Commands

```bash
pm2 logs claude-telegram-bot      # View logs
pm2 restart claude-telegram-bot   # Restart
pm2 stop claude-telegram-bot      # Stop
pm2 delete claude-telegram-bot    # Remove
```

## Updating

Re-run the installer to pull latest and rebuild:

```bash
curl -fsSL https://raw.githubusercontent.com/gididaf/claude-code-telegram/main/install.sh | bash
```

Or manually:

```bash
cd ~/.claude-telegram-bot
git pull && npm install && npm run build
pm2 restart claude-telegram-bot
```

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/gididaf/claude-code-telegram/main/uninstall.sh | bash
```

## License

MIT
