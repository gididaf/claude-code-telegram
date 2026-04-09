import type { Context } from 'grammy';
import { state } from '../state/session-state.js';
import { listProjects, listSessions } from '../services/projects.js';
import { sessionListKeyboard, sessionListKeyboardByDir } from '../ui/keyboards.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pathToDirName(path: string): string {
  return '-' + path.substring(1).replace(/\//g, '-');
}

export async function handleSession(ctx: Context): Promise<void> {
  if (!state.currentProjectPath) {
    await ctx.reply('No project selected. Use /projects first.');
    return;
  }

  const projects = await listProjects();
  const projectIdx = projects.findIndex(p => p.originalPath === state.currentProjectPath);

  const dirName = projectIdx >= 0
    ? projects[projectIdx].dirName
    : pathToDirName(state.currentProjectPath);

  const sessions = await listSessions(dirName);

  if (sessions.length === 0) {
    await ctx.reply('No sessions found. Send a message to start one.');
    return;
  }

  const { keyboard, pageInfo } = projectIdx >= 0
    ? sessionListKeyboard(sessions, projectIdx, 0)
    : sessionListKeyboardByDir(sessions, 0);

  const text = `<b>💬 Sessions</b> (${pageInfo.totalItems} total)\n\nSelect a session to resume:`;

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

export async function handleStatus(ctx: Context): Promise<void> {
  const text = state.currentProjectPath
    ? `<b>📊 Status</b>\n\n` +
      `<b>Project:</b> <code>${escapeHtml(state.currentProjectPath)}</code>\n` +
      `<b>Session:</b> ${state.currentSessionId ? state.currentSessionId.substring(0, 8) + '...' : 'None'}\n` +
      `<b>Processing:</b> ${state.isProcessing ? 'Yes ⏳' : 'No'}`
    : '<b>📊 Status</b>\n\nNo project selected.';

  await ctx.reply(text, { parse_mode: 'HTML' });
}
