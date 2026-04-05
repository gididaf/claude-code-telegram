import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { state } from '../state/session-state.js';
import { listProjects, listSessions } from '../services/projects.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function handleSession(ctx: Context): Promise<void> {
  if (!state.currentProjectPath) {
    await ctx.reply('No project selected. Use /projects first.');
    return;
  }

  const projects = await listProjects();
  const projectIdx = projects.findIndex(p => p.originalPath === state.currentProjectPath);

  let sessionSummary = 'None (new session)';
  if (state.currentSessionId) {
    const project = projectIdx >= 0 ? projects[projectIdx] : null;
    if (project) {
      const sessions = await listSessions(project.dirName);
      const session = sessions.find(s => s.sessionId === state.currentSessionId);
      if (session) sessionSummary = session.summary;
    }
  }

  const text =
    `<b>💬 Session</b>\n\n` +
    `<b>Project:</b> <code>${escapeHtml(state.currentProjectPath)}</code>\n` +
    `<b>Session:</b> ${escapeHtml(sessionSummary)}`;

  const kb = new InlineKeyboard();

  if (state.currentSessionId) {
    kb.text('📜 History', 'sh:0').row();
  }

  if (projectIdx >= 0) {
    kb.text('📋 Switch Session', `sl:${projectIdx}:0`)
      .text('✨ New Session', `sn:${projectIdx}`);
  } else {
    kb.text('📋 Switch Session', 'slc:0')
      .text('✨ New Session', 'snc');
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
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
