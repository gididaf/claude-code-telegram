<h1 align="center">Claude Code Telegram</h1>

<p align="center">
  <strong>Your entire dev environment in your pocket. Code from anywhere.</strong>
</p>

<p align="center">
  <a href="#-quick-install">Quick Install</a> &bull;
  <a href="#-features">Features</a> &bull;
  <a href="#-commands">Commands</a> &bull;
  <a href="#%EF%B8%8F-configuration">Configuration</a>
</p>

---

A Telegram bot that puts the **full power** of [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) in your hands — literally. Browse projects, manage sessions, send photos and voice messages, review diffs, execute plans — all from your phone with live-streaming responses and native Telegram UI.

This isn't a ChatGPT wrapper. It's a **remote control for your actual dev machine**: real sessions, real file edits, real git operations. Send a voice message from bed and wake up to a pull request. Send a screenshot of a bug and watch Claude fix it in real-time. Every session persists in `~/.claude/projects/` — seamlessly continue from the CLI, VS Code, or Telegram.

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

### Voice Messages

Talk to Claude with your voice. Send a Telegram voice message and it gets transcribed locally via [whisper.cpp](https://github.com/ggerganov/whisper.cpp) and sent to Claude as text — **completely free, no API costs**.

**Don't have whisper.cpp installed?** No problem. The first time you send a voice message, the bot offers an install button — tap it and Claude installs everything for you automatically.

> **Optional dependency:** Voice requires `whisper.cpp` + `ffmpeg`. Without them, everything else works perfectly — voice messages just show an install prompt. ~150MB one-time download for the speech model.

### Photo & File Attachments

Send **screenshots, photos, PDFs, and documents** directly in the chat. They're downloaded and passed to Claude Code which reads them natively — perfect for sharing error screenshots, mockups, or reference docs. Supports captions, multiple files, and Telegram albums.

### Live Streaming Responses

Responses update in real-time as Claude thinks and writes. Messages are debounced to respect Telegram's rate limits and automatically split across multiple messages when they exceed the 4096-character limit. Markdown is converted to Telegram-safe HTML with code blocks, inline code, bold, italic, and headers.

### Real-Time Tool Indicators

See exactly what Claude is doing as it works:

```
🔧 Bash: npm test
🔧 Read: src/index.ts
🔧 Edit: src/handlers/chat.ts
```

When a tool completes, indicators update in-place:

```
✅ Bash: npm test (47 lines)
✅ Read: src/index.ts (24 lines)
❌ Edit: src/handlers/chat.ts (error)
```

### Git Diff Viewer

Review changes with `/diff` — see a file list with `+N -N` stats as inline buttons. Tap any file to view its diff with syntax highlighting (green/red lines on supported Telegram clients). Works while Claude is processing. Supports custom git diff arguments.

### Project & Session Management

- **Browse all projects** — paginated inline keyboards with session counts
- **Resume any session** — pick up exactly where you left off
- **Start fresh sessions** — new conversation in the current project
- **Session metadata** — message count, timestamps, git branch, first prompt preview

### Session History & Rewind

Browse the full conversation history of any session — only meaningful exchanges, no tool noise. **Rewind to any previous Claude message** to branch the conversation from that point.

### Plan Mode

Claude can create structured plans. When a plan is created, you get action buttons:

- **Implement** — tells Claude to execute the plan
- **View Plan** — displays the full plan in Telegram
- **Refine** — iterate on the plan with your feedback

### Interactive Questions

When Claude asks questions, they appear as native Telegram inline keyboards — single-select, multi-select, free text, or mixed. Multiple questions are shown sequentially. No awkward copy-pasting.

### Message Queue

Send messages while Claude is busy — they queue automatically with a cancel button. When Claude finishes, the queued message fires immediately. No waiting, no lost messages.

### Inline Cancel

Every streaming response includes a **Cancel** button. Cancellation is graceful — Claude saves the interrupted turn, preserving full context. After cancel, any queued message auto-processes.

### Compact Conversations

Running low on context? Use `/compact` to compress the conversation history. Optionally pass instructions to focus the summary (e.g. `/compact focus on the auth refactor`).

### Direct Shell Access

Run shell commands directly with `/bash` — no Claude involved. 30-second timeout, formatted output. Great for quick `git status`, `ls`, or `npm test` checks.

### Context Usage Tracking

Every response shows context window usage and execution time:

```
📊 12.4% context | ⏱ 8.3s
```

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
| `/compact` | Compact conversation to free context |
| `/diff` | Show git changes with interactive file picker |

Just **type a message** to chat with Claude. Send a **voice message** or **photo** and it works too.

## How It Works

```
You type a message in Telegram (or send a voice memo, photo, file)
  → Voice: whisper.cpp transcribes to text
  → Photos/files: downloaded and referenced in the prompt
  → Bot spawns: claude -p "message" --output-format stream-json --verbose
  → Stream events parsed line-by-line (init, text-delta, tool-use, tool-result, result)
  → Telegram message edited live every ~2.5s as tokens arrive
  → Tools shown as 🔧 indicators, updated to ✅/❌ on completion
  → Final response formatted as HTML, auto-split if needed
  → Queue drains automatically if messages are waiting
```

Sessions are real Claude Code sessions stored in `~/.claude/projects/`. Continue them from the CLI, VS Code, or Telegram interchangeably.

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
| `WHISPER_MODEL` | No | `base` | Whisper model name for voice (tiny/base/small/medium) |
| `WHISPER_MODEL_PATH` | No | — | Full path to a whisper model `.bin` file |

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
