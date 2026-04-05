import type { Context } from 'grammy';
import { state, resetProcessState } from '../state/session-state.js';

export async function handleCancel(ctx: Context): Promise<void> {
  if (!state.isProcessing || !state.runningClaude) {
    await ctx.reply('Nothing is running.');
    return;
  }

  state.runningClaude.kill();
  resetProcessState();
  await ctx.reply('Cancelled.');
}
