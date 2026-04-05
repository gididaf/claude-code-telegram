# Claude Code Telegram

## Overview

Telegram bot that lets you control [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) from your phone. Spawns `claude` in stream-json mode, parses output, and relays it to Telegram with live-updating messages.

**Repo:** https://github.com/gididaf/claude-code-telegram
**Stack:** TypeScript, Node.js (ESM), grammy, PM2

## Commands

```bash
npm run dev      # Run with tsx (hot reload)
npm run build    # Compile TypeScript to dist/
npm start        # Run compiled JS
```

## Architecture

Single-user, single-process. No database — all state is in-memory (`src/state/session-state.ts`). Bot uses long polling (not webhooks).

### Data Flow (sending a prompt)

```
User types message → auth middleware → chat handler
  → sends "⏳ Thinking..." message with inline ✋ Cancel button
  → spawns: claude -p "msg" --dangerously-skip-permissions --output-format stream-json --verbose --include-partial-messages [-r sessionId]
  → stream events parsed line-by-line as JSON
  → Telegram message edited every ~2.5s with accumulated text
  → on result: format with markdown→HTML, split at ~3800 chars, edit/send final messages
```

### Key Modules

- **`src/services/claude.ts`** — ClaudeProcess (EventEmitter). Spawns CLI, parses stream-json. Events: init, text-delta, tool-use, tool-result, assistant-text, result, error. Has `cancelled` flag to suppress errors on intentional kill. Tracks `toolNames` map (tool_use_id → name) to enrich tool-result events with name, line count, and error status.
- **`src/handlers/chat.ts`** — Orchestrates prompt → stream → live edit → split messages. 3-layer fallback: HTML edit → plain text edit → new message.
- **`src/services/projects.ts`** — Reads `~/.claude/projects/`. Scans actual `.jsonl` files on disk, enriches with sessions-index.json metadata where available. Filters non-existent directories. Also provides `getSessionHistory()` for reading full conversation and `forkSessionAt()` for creating truncated session forks.
- **`src/ui/formatter.ts`** — Markdown→HTML (code blocks, inline code, bold, italic, headers). Splits raw text FIRST, then converts each chunk to HTML independently (prevents mid-tag splitting).
- **`src/handlers/callbacks.ts`** — Central callback router for all inline keyboard actions.
- **`src/services/directory-browser.ts`** — Filesystem navigation. In-memory `pathCache` Map solves Telegram's 64-byte callback data limit.
- **`src/state/session-state.ts`** — Single `BotState` object. `awaitingFolderName` distinguishes folder name input from Claude prompts.

### Callback Data Scheme

Telegram limits callback data to 64 bytes. Short prefixes:

| Prefix | Meaning | Example |
|--------|---------|---------|
| `cancel` | Cancel running process | `cancel` |
| `p:` | Project list page | `p:0` |
| `ps:` | Project select | `ps:3` |
| `pr:` | Resume latest session | `pr:3` |
| `sl:` | Session list | `sl:3:0` (project:page) |
| `ss:` | Session select | `ss:3:5` (project:session) |
| `sn:` | New session | `sn:3` |
| `d:` | Directory navigate | `d:42` (pathCache ID) |
| `ds:` | Directory select | `ds:42` |
| `dp:` | Directory page | `dp:42:1` (pathId:page) |
| `cf:` | Create folder | `cf:42` |
| `sh:` | Session history page | `sh:0` |
| `sf:` | Fork session at message | `sf:7` |
| `slc:` | Session list (current project) | `slc:0` |
| `ssc:` | Session select (current) | `ssc:2` |
| `snc` | New session (current) | `snc` |

## Telegram Constraints

- **4096 char limit** per message — split at ~3800 raw chars, then convert to HTML
- **~5 edits/msg/min** — debounce streaming edits to every ~2.5s
- **64 byte callback data** — use short prefixes + in-memory path cache for directory browser
- **HTML parse mode** — only safe subset: `<b>`, `<i>`, `<code>`, `<pre>`, `<s>`. Unclosed tags cause API errors.

## Known Patterns & Gotchas

- `escapeHtml()` is duplicated across several files (handlers, formatter) — intentional to keep each module self-contained.
- `pathToDirName()` converts absolute paths to Claude's project dir format: `/Users/foo/bar` → `-Users-foo-bar`. Also duplicated in `sessions.ts` and `callbacks.ts` since `state.currentProjectDir` may be null (e.g. when using `DEFAULT_PROJECT_PATH`).
- `sessions-index.json` can be stale — it may reference sessions whose `.jsonl` files no longer exist on disk. `listSessions()` validates against actual files and merges in on-disk sessions missing from the index.
- UUID-named subdirectories in project dirs are subagent containers, not sessions — only `.jsonl` files are sessions.
- The `cancelled` flag on ClaudeProcess prevents "exited with code 143" errors when user runs /cancel.
- Formatter splits raw text FIRST then converts each chunk to HTML. This was a critical fix — splitting HTML can break mid-tag.
- Tool indicators (`🔧 Bash: ls -la`) are embedded in `accumulatedText` during streaming, then replaced by the final result. When a tool completes, its `🔧` line is replaced **in-place** with `✅`/`❌` + line count (e.g. `✅ Bash: ls -la (13 lines)`). Uses `indexOf` to match the first unreplaced `🔧` for that tool name — handles parallel same-name tools correctly.
- Inline ✋ Cancel button is attached to the "Thinking..." message and all streaming edits via `reply_markup`. The keyboard is automatically removed when the final result/error edit omits `reply_markup`. The cancel callback in `callbacks.ts` kills the process, resets state, and edits the message to "🚫 Cancelled."
- **Session JSONL format**: Each line is a single content block (not a full message). An assistant turn spans multiple lines: thinking, text, tool_use. User tool_result lines follow. Real user prompts are `{role: "user", content: "string"}` lines.
- **Fork**: Creates a new `.jsonl` with lines truncated at a specific visible message. Only fork at **assistant messages** — forking at a user message would leave a dangling user turn, causing two consecutive user messages when resumed. The original session file is never modified.
- **History**: `/history` command and `📜 View History` button. Filters JSONL to show only user text prompts and assistant text responses (skips tool_use, tool_result, thinking, system lines). Messages numbered for fork reference.

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | — |
| `TELEGRAM_USER_ID` | Yes | — |
| `CLAUDE_CLI_PATH` | No | `claude` |
| `DEFAULT_PROJECT_PATH` | No | null |
| `STREAM_UPDATE_INTERVAL_MS` | No | `2500` |
| `PROCESS_TIMEOUT_MS` | No | `300000` |
