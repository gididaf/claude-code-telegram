import type { Context } from 'grammy';
import { handleProjects } from './projects.js';
import {
  handleProjectSelect,
  handleSessionList,
  handleSessionSelect,
  handleResumeLatest,
  handleNewSession,
} from './sessions.js';
import { handleNewProject, handleDirNavigate, handleDirSelect, handleCreateFolderPrompt } from './newproject.js';
import { decodePath } from '../services/directory-browser.js';
import { listSessions } from '../services/projects.js';
import { sessionListKeyboardByDir } from '../ui/keyboards.js';
import { state } from '../state/session-state.js';

export async function handleCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  try {
    // Project list pages: p:0, p:1, ...
    if (data.startsWith('p:')) {
      const page = parseInt(data.substring(2), 10);
      await handleProjects(ctx, page);
      await ctx.answerCallbackQuery();
      return;
    }

    // Project select: ps:3
    if (data.startsWith('ps:')) {
      const idx = parseInt(data.substring(3), 10);
      await handleProjectSelect(ctx, idx);
      await ctx.answerCallbackQuery();
      return;
    }

    // Resume latest session: pr:3
    if (data.startsWith('pr:')) {
      const idx = parseInt(data.substring(3), 10);
      await handleResumeLatest(ctx, idx);
      await ctx.answerCallbackQuery();
      return;
    }

    // Session list: sl:3:0 (projectIndex:page)
    if (data.startsWith('sl:')) {
      const parts = data.substring(3).split(':');
      const projectIdx = parseInt(parts[0], 10);
      const page = parseInt(parts[1], 10);
      await handleSessionList(ctx, projectIdx, page);
      await ctx.answerCallbackQuery();
      return;
    }

    // Session select: ss:3:5 (projectIndex:sessionIndex)
    if (data.startsWith('ss:')) {
      const parts = data.substring(3).split(':');
      const projectIdx = parseInt(parts[0], 10);
      const sessionIdx = parseInt(parts[1], 10);
      await handleSessionSelect(ctx, projectIdx, sessionIdx);
      await ctx.answerCallbackQuery();
      return;
    }

    // New session: sn:3
    if (data.startsWith('sn:')) {
      const idx = parseInt(data.substring(3), 10);
      await handleNewSession(ctx, idx);
      await ctx.answerCallbackQuery();
      return;
    }

    // Directory browser: navigate to dir
    if (data.startsWith('d:')) {
      await handleDirNavigate(ctx, data);
      await ctx.answerCallbackQuery();
      return;
    }

    // Directory browser: select dir as project
    if (data.startsWith('ds:')) {
      await handleDirSelect(ctx, data);
      await ctx.answerCallbackQuery();
      return;
    }

    // Directory browser: pagination dp:pathId:page
    if (data.startsWith('dp:')) {
      const parts = data.split(':');
      const pathId = parseInt(parts[1], 10);
      const page = parseInt(parts[2], 10);
      const path = decodePath(`d:${pathId}`);
      if (path) {
        // Re-import to avoid circular — just call navigate with reconstructed data
        await handleDirNavigate(ctx, `d:${pathId}`, page);
      }
      await ctx.answerCallbackQuery();
      return;
    }

    // Create folder prompt: cf:pathId
    if (data.startsWith('cf:')) {
      const pathId = parseInt(data.substring(3), 10);
      await handleCreateFolderPrompt(ctx, `d:${pathId}`);
      await ctx.answerCallbackQuery();
      return;
    }

    // Session list for current project (no index): slc:page
    if (data.startsWith('slc:')) {
      const page = parseInt(data.substring(4), 10);
      if (!state.currentProjectPath) {
        await ctx.answerCallbackQuery('No project selected');
        return;
      }
      const dirName = pathToDirName(state.currentProjectPath);
      const sessions = await listSessions(dirName);
      if (sessions.length === 0) {
        await ctx.answerCallbackQuery('No sessions found');
        return;
      }
      const { keyboard, pageInfo } = sessionListKeyboardByDir(sessions, page);
      const text = `<b>💬 Sessions</b>\n${pageInfo.totalItems} sessions total\n\nSelect a session to resume:`;
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
      await ctx.answerCallbackQuery();
      return;
    }

    // Session select for current project: ssc:sessionIndex
    if (data.startsWith('ssc:')) {
      const sessionIdx = parseInt(data.substring(4), 10);
      if (!state.currentProjectPath) {
        await ctx.answerCallbackQuery('No project selected');
        return;
      }
      const dirName = pathToDirName(state.currentProjectPath);
      const sessions = await listSessions(dirName);
      const session = sessions[sessionIdx];
      if (!session) {
        await ctx.answerCallbackQuery('Session not found');
        return;
      }
      state.currentSessionId = session.sessionId;
      const text =
        `<b>✅ Session loaded</b>\n\n` +
        `<b>Session:</b> ${escapeHtml(session.summary)}\n` +
        `<b>Messages:</b> ${session.messageCount}\n\n` +
        `Send a message to continue this session.`;
      await ctx.editMessageText(text, { parse_mode: 'HTML' });
      await ctx.answerCallbackQuery();
      return;
    }

    // New session in current project (no index needed)
    if (data === 'snc') {
      state.currentSessionId = null;
      await ctx.editMessageText(
        `<b>✨ New session</b>\n\nSend a message to start.`,
        { parse_mode: 'HTML' }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    // New project (from /start keyboard)
    if (data === 'new') {
      await handleNewProject(ctx);
      await ctx.answerCallbackQuery();
      return;
    }

    // No-op (page indicator button)
    if (data === 'noop') {
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery('Unknown action');
  } catch (err: any) {
    console.error('Callback error:', err.message);
    await ctx.answerCallbackQuery('Error occurred');
  }
}

function pathToDirName(path: string): string {
  return '-' + path.substring(1).replace(/\//g, '-');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
