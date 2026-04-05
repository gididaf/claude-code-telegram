import type { Context } from 'grammy';
import { runClaude } from '../services/claude.js';
import { state, resetProcessState } from '../state/session-state.js';
import { config } from '../config.js';
import { formatForTelegram, formatCostFooter, truncateForEdit, type FormattedMessage } from '../ui/formatter.js';
import { cancelKeyboard } from '../ui/keyboards.js';
import { handleFolderNameInput } from './newproject.js';

export async function handleChat(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  // Check if we're waiting for a folder name
  if (await handleFolderNameInput(ctx)) return;

  if (state.isProcessing) {
    await ctx.reply('Claude is still working. Use /cancel to stop it.');
    return;
  }

  if (!state.currentProjectPath) {
    await ctx.reply(
      'No project selected. Use /projects to browse or /new to create one.\n\n' +
      'Or set DEFAULT_PROJECT_PATH in your .env file.'
    );
    return;
  }

  state.isProcessing = true;
  state.accumulatedText = '';

  const thinkingMsg = await ctx.reply('⏳ Thinking...', { reply_markup: cancelKeyboard() });
  state.lastResponseMessageId = thinkingMsg.message_id;
  state.lastResponseChatId = ctx.chat!.id;

  const claude = runClaude({
    prompt: text,
    cwd: state.currentProjectPath,
    resumeSessionId: state.currentSessionId || undefined,
  });

  state.runningClaude = claude;

  let lastEditTime = 0;
  let editTimer: ReturnType<typeof setTimeout> | null = null;
  let currentMessageIds: number[] = [thinkingMsg.message_id];
  let sentChunks = 0;

  const doEdit = async () => {
    if (!state.accumulatedText || !state.isProcessing) return;

    const displayText = truncateForEdit(state.accumulatedText, '\n\n⏳ ...');
    const targetMsgId = currentMessageIds[currentMessageIds.length - 1];

    try {
      await ctx.api.editMessageText(
        state.lastResponseChatId!,
        targetMsgId,
        displayText,
        { reply_markup: cancelKeyboard() }
      );
      lastEditTime = Date.now();
    } catch (err: any) {
      // "message is not modified" is fine — just means no new text yet
      if (!err.message?.includes('message is not modified')) {
        console.error('Edit error:', err.message);
      }
    }
  };

  const scheduleEdit = () => {
    if (editTimer) return;
    const elapsed = Date.now() - lastEditTime;
    const delay = Math.max(0, config.streamUpdateIntervalMs - elapsed);
    editTimer = setTimeout(async () => {
      editTimer = null;
      await doEdit();
    }, delay);
  };

  claude.on('init', (sessionId) => {
    state.currentSessionId = sessionId;
  });

  claude.on('text-delta', (_delta) => {
    scheduleEdit();
  });

  claude.on('tool-use', (toolName, detail) => {
    const info = detail ? `${toolName}: ${detail}` : toolName;
    state.accumulatedText += `\n🔧 ${info}\n`;
    scheduleEdit();
  });

  claude.on('tool-result', (toolName, lineCount, isError) => {
    const icon = isError ? '❌' : '✅';
    const lines = lineCount > 0 ? ` (${lineCount} lines)` : '';

    // Replace the first unreplaced 🔧 line for this tool with the result
    const marker = `🔧 ${toolName}`;
    const idx = state.accumulatedText.indexOf(marker);
    if (idx !== -1) {
      const lineEnd = state.accumulatedText.indexOf('\n', idx);
      const oldLine = lineEnd !== -1
        ? state.accumulatedText.substring(idx, lineEnd)
        : state.accumulatedText.substring(idx);
      const newLine = oldLine.replace('🔧', icon) + lines;
      state.accumulatedText = lineEnd !== -1
        ? state.accumulatedText.substring(0, idx) + newLine + state.accumulatedText.substring(lineEnd)
        : state.accumulatedText.substring(0, idx) + newLine;
    } else {
      // Fallback: append as separate line
      state.accumulatedText += `${icon} ${toolName}${lines}\n`;
    }
    scheduleEdit();
  });

  claude.on('result', async (resultText, sessionId, costUsd, durationMs) => {
    if (editTimer) {
      clearTimeout(editTimer);
      editTimer = null;
    }

    state.currentSessionId = sessionId;

    const finalText = resultText || state.accumulatedText || '(empty response)';
    const costFooter = formatCostFooter(costUsd, durationMs);
    const chunks = formatForTelegram(finalText);
    const chatId = state.lastResponseChatId!;
    const firstMsgId = currentMessageIds[currentMessageIds.length - 1];

    // Helper: try HTML, then plain text, then new message as last resort
    const editOrSend = async (text: string, parseMode: 'HTML' | undefined, editMsgId: number | null, append: string) => {
      const content = text + append;
      // Try with parse mode
      if (parseMode) {
        try {
          if (editMsgId) {
            await ctx.api.editMessageText(chatId, editMsgId, content, { parse_mode: parseMode });
          } else {
            await ctx.api.sendMessage(chatId, content, { parse_mode: parseMode });
          }
          return;
        } catch (err: any) {
          console.error('HTML send failed, falling back to plain text:', err.message);
        }
      }

      // Plain text (no parse_mode)
      const plain = text.substring(0, 4000 - append.length) + append;
      try {
        if (editMsgId) {
          await ctx.api.editMessageText(chatId, editMsgId, plain);
        } else {
          await ctx.api.sendMessage(chatId, plain);
        }
      } catch (err: any) {
        console.error('Plain text edit failed, sending as new message:', err.message);
        // Last resort: send as a new message
        if (editMsgId) {
          await ctx.api.sendMessage(chatId, plain);
        }
      }
    };

    try {
      // First chunk replaces the streaming message
      const isOnly = chunks.length === 1;
      await editOrSend(chunks[0].text, chunks[0].parseMode, firstMsgId, isOnly ? costFooter : '');

      // Remaining chunks as new messages
      for (let i = 1; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        await editOrSend(chunks[i].text, chunks[i].parseMode, null, isLast ? costFooter : '');
      }
    } catch (err: any) {
      console.error('Failed to send final message:', err.message);
      try { await ctx.api.sendMessage(chatId, finalText.substring(0, 4000)); } catch { /* ignore */ }
    }

    resetProcessState();
  });

  claude.on('error', async (errorMsg) => {
    if (editTimer) {
      clearTimeout(editTimer);
      editTimer = null;
    }

    try {
      await ctx.api.editMessageText(
        state.lastResponseChatId!,
        currentMessageIds[currentMessageIds.length - 1],
        `❌ Error: ${errorMsg}`
      );
    } catch {
      try { await ctx.reply(`❌ Error: ${errorMsg}`); } catch { /* ignore */ }
    }
    resetProcessState();
  });
}
