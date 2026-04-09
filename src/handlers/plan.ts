import type { Context } from 'grammy';
import { readFile } from 'fs/promises';
import { state } from '../state/session-state.js';
import { formatForTelegram } from '../ui/formatter.js';
import { planKeyboard } from '../ui/keyboards.js';

export async function handlePlan(ctx: Context): Promise<void> {
  if (!state.currentPlanPath) {
    await ctx.reply('No plan in current session.\n\nAsk Claude to create a plan and it will use plan mode automatically.');
    return;
  }

  try {
    const content = await readFile(state.currentPlanPath, 'utf-8');
    const chunks = formatForTelegram(content);
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      try {
        await ctx.api.sendMessage(ctx.chat!.id, chunks[i].text, {
          parse_mode: chunks[i].parseMode,
          ...(isLast ? { reply_markup: planKeyboard() } : {}),
        });
      } catch {
        await ctx.api.sendMessage(ctx.chat!.id, chunks[i].text.substring(0, 4000), {
          ...(isLast ? { reply_markup: planKeyboard() } : {}),
        });
      }
    }
  } catch {
    await ctx.reply('Could not read plan file. It may have been deleted.');
    state.currentPlanPath = null;
  }
}
