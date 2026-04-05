import type { Context } from 'grammy';
import { listProjects } from '../services/projects.js';
import { projectListKeyboard } from '../ui/keyboards.js';

export async function handleProjects(ctx: Context, page: number = 0): Promise<void> {
  const projects = await listProjects();

  if (projects.length === 0) {
    await ctx.reply('No Claude Code projects found in ~/.claude/projects/');
    return;
  }

  const { keyboard, pageInfo } = projectListKeyboard(projects, page);

  const text = `<b>📂 Projects</b> (${pageInfo.totalItems} total)\n\nSelect a project:`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}
