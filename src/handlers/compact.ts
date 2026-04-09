import type { Context } from 'grammy';
import { runClaude } from '../services/claude.js';
import { state, resetProcessState } from '../state/session-state.js';
import { formatCostFooter } from '../ui/formatter.js';
import { drainQueue } from './chat.js';

export async function handleCompact(ctx: Context): Promise<void> {
  if (!state.currentProjectPath || !state.currentSessionId) {
    await ctx.reply('No active session to compact. Start a conversation first.');
    return;
  }

  if (state.isProcessing) {
    await ctx.reply('Claude is busy. Wait for it to finish first.');
    return;
  }

  const args = (ctx.message?.text || '').replace(/^\/compact\s*/, '').trim();
  const prompt = args ? `/compact ${args}` : '/compact';

  state.isProcessing = true;
  const msg = await ctx.reply('⏳ Compacting conversation...');
  const chatId = ctx.chat!.id;

  const claude = runClaude({
    prompt,
    cwd: state.currentProjectPath,
    resumeSessionId: state.currentSessionId,
  });

  state.runningClaude = claude;

  claude.on('result', async (_resultText, sessionId, durationMs, contextPercent) => {
    state.currentSessionId = sessionId;
    resetProcessState();

    const footer = formatCostFooter(durationMs, contextPercent);
    try {
      await ctx.api.editMessageText(chatId, msg.message_id, `✅ Conversation compacted${footer}`);
    } catch { /* ignore */ }

    await drainQueue(ctx.api, chatId);
  });

  claude.on('error', async (errorMsg) => {
    resetProcessState();
    try {
      await ctx.api.editMessageText(chatId, msg.message_id, `❌ Compact failed: ${errorMsg}`);
    } catch { /* ignore */ }

    await drainQueue(ctx.api, chatId);
  });
}
