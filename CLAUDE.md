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

### Slash Commands

| Command | Handler | Description |
|---------|---------|-------------|
| `/start` | `start.ts` | Welcome message + inline keyboard |
| `/projects` | `projects.ts` | Browse projects + "New from Directory" button |
| `/new` | `newproject.ts:handleNewCommand` | Start new session in current project |
| `/resume` | `status.ts:handleSession` | Show session list for current project |
| `/rewind` | `sessions.ts:handleHistoryCommand` | View session history + rewind |
| `/status` | `status.ts:handleStatus` | Show current state |
| `/bash` | `bash.ts:handleBash` | Run shell command directly (not through Claude) |
| `/plan` | `plan.ts:handlePlan` | View current plan + implement/discard buttons |

Commands are registered in `bot.ts` and autocomplete is set via `setMyCommands` in `index.ts`.

### Data Flow (sending a prompt)

```
User types message → auth middleware → chat handler
  → if Claude is busy: queue message (single slot, latest wins), show "📝 … Queued" with ❌ Cancel
  → otherwise: sends "⏳ Thinking..." message with inline ✋ Cancel button
  → spawns: claude -p "msg" --dangerously-skip-permissions --output-format stream-json --verbose --include-partial-messages [-r sessionId]
  → stream events parsed line-by-line as JSON
  → Telegram message edited every ~2.5s with accumulated text
  → on result: format with markdown→HTML, split at ~3800 chars, edit/send final messages
  → drain queue: if queued message exists, edit notification to "💬 …" and auto-process
```

### Key Modules

- **`src/services/claude.ts`** — ClaudeProcess (EventEmitter). Spawns CLI, parses stream-json. Events: init, text-delta, tool-use, tool-result, assistant-text, ask-user, result, error. Has `cancelled` flag to suppress errors on intentional kill. Tracks `toolNames` map (tool_use_id → name) to enrich tool-result events with name, line count, and error status.
- **`src/handlers/chat.ts`** — Orchestrates prompt → stream → live edit → split messages. 3-layer fallback: HTML edit → plain text edit → new message. Exports `drainQueue()`, `showCurrentQuestion()`, `submitQuestionAnswers()` for use by callbacks. Core logic in `processPrompt()` (called by both `handleChat` and `drainQueue`).
- **`src/services/projects.ts`** — Reads `~/.claude/projects/`. Scans actual `.jsonl` files on disk, enriches with sessions-index.json metadata where available. Filters non-existent directories. Also provides `getSessionHistory()` for reading full conversation and `rewindSessionTo()` for truncating a session in-place.
- **`src/ui/formatter.ts`** — Markdown→HTML (code blocks, inline code, bold, italic, headers). Splits raw text FIRST, then converts each chunk to HTML independently (prevents mid-tag splitting).
- **`src/handlers/callbacks.ts`** — Central callback router for all inline keyboard actions.
- **`src/services/directory-browser.ts`** — Filesystem navigation. In-memory `pathCache` Map solves Telegram's 64-byte callback data limit.
- **`src/handlers/bash.ts`** — Direct shell command execution via `/bash`. Runs in current project dir, 30s timeout, output in `<pre>` block.
- **`src/state/session-state.ts`** — Single `BotState` object. `awaitingFolderName` distinguishes folder name input from Claude prompts. Queue state: `queuedMessage`, `queuedMessageId`, `queuedChatId`. `pendingQuestion` tracks AskUserQuestion state.

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
| `new` | New session (from /start) | `new` |
| `newdir` | Browse directory (new project) | `newdir` |
| `d:` | Directory navigate | `d:42` (pathCache ID) |
| `ds:` | Directory select | `ds:42` |
| `dp:` | Directory page | `dp:42:1` (pathId:page) |
| `cf:` | Create folder | `cf:42` |
| `sh:` | Session history page | `sh:0` |
| `sr:` | Rewind session to message | `sr:7` |
| `cq` | Cancel queued message | `cq` |
| `pi` | Implement plan | `pi` |
| `pv` | View full plan | `pv` |
| `pd` | Discard plan | `pd` |
| `slc:` | Session list (current project) | `slc:0` |
| `ssc:` | Session select (current) | `ssc:2` |
| `aq:` | Answer question (single-select) | `aq:2` (option index) |
| `at:` | Toggle multi-select option | `at:1` (option index) |
| `as` | Submit multi-select answers | `as` |

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
- The `cancelled` flag on ClaudeProcess prevents post-cancel `result`/`error` events from editing messages. The `result` handler still captures the session ID even when cancelled.
- Formatter splits raw text FIRST then converts each chunk to HTML. This was a critical fix — splitting HTML can break mid-tag.
- Tool indicators (`🔧 Bash: ls -la`) are embedded in `accumulatedText` during streaming, then replaced by the final result. When a tool completes, its `🔧` line is replaced **in-place** with `✅`/`❌` + line count (e.g. `✅ Bash: ls -la (13 lines)`). Uses `indexOf` to match the first unreplaced `🔧` for that tool name — handles parallel same-name tools correctly.
- **Cancel/Interrupt**: Uses SIGINT (not SIGTERM) so the CLI saves the interrupted turn to the session file before exiting. This preserves full conversation context across interruptions — the next message resumes the same session with `-r` and Claude has the complete history including the interrupted turn. Escalates to SIGTERM after 3s, SIGKILL after 6s. The cancel callback keeps the streaming message with accumulated text + "⚠️ Interrupted". If a queued message exists, it auto-drains; otherwise sends "Interrupted · What should Claude do instead?". No `/cancel` command — only the inline ✋ button.
- Inline ✋ Cancel button is attached to the "Thinking..." message and all streaming edits via `reply_markup`. The keyboard is automatically removed when the final result/error edit omits `reply_markup`.
- **Session JSONL format**: Each line is a single content block (not a full message). An assistant turn spans multiple lines: thinking, text, tool_use. User tool_result lines follow. Real user prompts are `{role: "user", content: "string"}` lines.
- **Rewind**: Truncates the current `.jsonl` **in-place** at a specific visible message (no fork/copy). Only rewind to **assistant messages** — rewinding to a user message would leave a dangling user turn, causing two consecutive user messages when resumed.
- **History**: `/rewind` command. Filters JSONL to show only user text prompts and assistant text responses (skips tool_use, tool_result, thinking, system lines). Messages numbered for rewind reference.
- **Message Queue**: Single-slot queue. When user sends a message while Claude is busy, the user's message is deleted and replaced with a bot "📝 … Queued" notification with ❌ Cancel. Subsequent messages edit the same notification (latest wins). On result/error/cancel, queue auto-drains: notification edited to "💬 …" (preserves context), then `processPrompt()` runs the queued text. Queue can also fire after cancel — if user cancels the running process and a queue exists, it sends immediately.
- **AskUserQuestion**: The CLI can't show interactive question UI in `-p` mode (returns `is_error=true`). We intercept the `tool_use` event, capture the question data, and after the result is displayed show the question as a separate Telegram message with inline keyboard buttons. Single-select: tap a button to answer immediately. Multi-select: toggle buttons (☐/☑) + Submit. Free text: user types a message (combined with any checked options for multi-select using `Selected: X, Y\nAdditional input: text` format). Supports 1-4 questions shown sequentially. Answers sent as next prompt in the same session via `-r`. State tracked in `state.pendingQuestion` (`QuestionData[]`, `currentIndex`, `answers`, `selectedOptions`).
- **`/bash` command**: Runs shell commands directly without Claude. Uses `child_process.exec` with 30s timeout in the current project directory. Output displayed in `<pre>` block with HTML escaping.
- **Plan Mode**: Claude can enter plan mode via `EnterPlanMode`/`ExitPlanMode` tools (works in `-p` mode). Plans are stored as MD files in `~/.claude/plans/` with random names (e.g. `flickering-leaping-eich.md`). The `ExitPlanMode` tool_use event contains `input.planFilePath` — the bot captures this to populate `state.currentPlanPath`. After a plan-creating result, bot sends a notification with ✅ Implement / 📋 View Plan / ❌ Discard buttons. `ExitPlanMode` returns `is_error: true` in `-p` mode (can't show confirmation UI) — Claude continues anyway and writes a text summary.
- **Context usage footer**: Shows `📊 X% context | ⏱ Xs` instead of cost. Calculated from `modelUsage` in the CLI result event: `(inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens) / contextWindow * 100`. The ~3% baseline on a 1M model is real — it's the CLI's system prompt, tool definitions, and CLAUDE.md.
- **messageCount**: Counts only visible messages (same filter as `getSessionHistory` — skips tool_use, tool_result, thinking, system/XML lines). This ensures `/resume` message count matches `/rewind` message count.

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | — |
| `TELEGRAM_USER_ID` | Yes | — |
| `CLAUDE_CLI_PATH` | No | `claude` |
| `DEFAULT_PROJECT_PATH` | No | null |
| `STREAM_UPDATE_INTERVAL_MS` | No | `2500` |
| `PROCESS_TIMEOUT_MS` | No | `300000` |
