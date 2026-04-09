import type { Context } from 'grammy';
import { startKeyboard } from '../ui/keyboards.js';
import { state } from '../state/session-state.js';

export async function handleStart(ctx: Context): Promise<void> {
  const statusLine = state.currentProjectPath
    ? `\n\n<b>Current project:</b> <code>${escapeHtml(state.currentProjectPath)}</code>`
    : '';

  const welcomeMessage =
    `<b>Claude Code Telegram</b>\n\n` +
    `Control Claude Code from your phone.\n\n` +
    `<b>Commands:</b>\n` +
    `/start — Show this message\n` +
    `/projects — Browse or switch projects\n` +
    `/resume — Switch or resume sessions\n` +
    `/new — Start new session\n` +
    `/rewind — Rewind session to a previous point` +
    statusLine;

  await ctx.reply(welcomeMessage, {
    parse_mode: 'HTML',
    reply_markup: startKeyboard(),
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
