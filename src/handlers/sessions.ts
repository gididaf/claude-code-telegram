import { access } from 'fs/promises';
import type { Context } from 'grammy';
import { listProjects, listSessions, getSessionHistory, rewindSessionTo } from '../services/projects.js';
import { sessionListKeyboard, historyKeyboard } from '../ui/keyboards.js';
import { state } from '../state/session-state.js';
import { paginate } from '../ui/paginator.js';

export async function handleProjectSelect(ctx: Context, projectIndex: number): Promise<void> {
  const projects = await listProjects();
  const project = projects[projectIndex];

  if (!project) {
    await ctx.answerCallbackQuery('Project not found');
    return;
  }

  const pathExists = await checkPathExists(project.originalPath);

  state.currentProjectPath = project.originalPath;
  state.currentProjectDir = project.dirName;
  state.currentSessionId = null;

  const warning = pathExists ? '' : '\n\n⚠️ <b>Warning:</b> Directory not found on disk. New prompts may fail.';
  const text =
    `<b>✨ New session</b>\n\n` +
    `📍 <code>${escapeHtml(project.originalPath)}</code>\n\n` +
    `Send a message to start.` +
    warning;

  await ctx.editMessageText(text, { parse_mode: 'HTML' });
}

export async function handleSessionList(ctx: Context, projectIndex: number, page: number): Promise<void> {
  const projects = await listProjects();
  const project = projects[projectIndex];

  if (!project) {
    await ctx.answerCallbackQuery('Project not found');
    return;
  }

  const sessions = await listSessions(project.dirName);

  if (sessions.length === 0) {
    await ctx.answerCallbackQuery('No sessions found');
    return;
  }

  const { keyboard, pageInfo } = sessionListKeyboard(sessions, projectIndex, page);
  const text =
    `<b>💬 Sessions</b> — ${escapeHtml(project.displayName)}\n` +
    `${pageInfo.totalItems} sessions total\n\nSelect a session to resume:`;

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

export async function handleSessionSelect(ctx: Context, projectIndex: number, sessionIndex: number): Promise<void> {
  const projects = await listProjects();
  const project = projects[projectIndex];

  if (!project) {
    await ctx.answerCallbackQuery('Project not found');
    return;
  }

  const sessions = await listSessions(project.dirName);
  const session = sessions[sessionIndex];

  if (!session) {
    await ctx.answerCallbackQuery('Session not found');
    return;
  }

  state.currentProjectPath = project.originalPath;
  state.currentProjectDir = project.dirName;
  state.currentSessionId = session.sessionId;

  const text =
    `<b>✅ Session loaded</b>\n\n` +
    `<b>Project:</b> ${escapeHtml(project.displayName)}\n` +
    `<b>Session:</b> ${escapeHtml(session.summary)}\n` +
    `<b>Messages:</b> ${session.messageCount}\n` +
    `<b>Branch:</b> ${escapeHtml(session.gitBranch || 'n/a')}\n` +
    `<b>Last active:</b> ${formatDate(session.modified)}\n\n` +
    `Send a message to continue this session.`;

  await ctx.editMessageText(text, { parse_mode: 'HTML' });
}

export async function handleResumeLatest(ctx: Context, projectIndex: number): Promise<void> {
  const projects = await listProjects();
  const project = projects[projectIndex];

  if (!project) {
    await ctx.answerCallbackQuery('Project not found');
    return;
  }

  const sessions = await listSessions(project.dirName);

  if (sessions.length === 0) {
    // No sessions — start fresh
    state.currentProjectPath = project.originalPath;
    state.currentProjectDir = project.dirName;
    state.currentSessionId = null;
    await ctx.editMessageText(
      `<b>✅ Project set:</b> ${escapeHtml(project.displayName)}\n\nNo previous sessions. Send a message to start fresh.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Resume the most recent session
  await handleSessionSelect(ctx, projectIndex, 0);
}

export async function handleNewSession(ctx: Context, projectIndex: number): Promise<void> {
  const projects = await listProjects();
  const project = projects[projectIndex];

  if (!project) {
    await ctx.answerCallbackQuery('Project not found');
    return;
  }

  state.currentProjectPath = project.originalPath;
  state.currentProjectDir = project.dirName;
  state.currentSessionId = null;

  await ctx.editMessageText(
    `<b>✨ New session</b> in ${escapeHtml(project.displayName)}\n\nSend a message to start.`,
    { parse_mode: 'HTML' }
  );
}

const HISTORY_PAGE_SIZE = 4;
const MSG_TRUNCATE_LEN = 500;

export async function handleSessionHistory(ctx: Context, page: number): Promise<void> {
  if (!state.currentProjectPath || !state.currentSessionId) {
    try { await ctx.answerCallbackQuery('No session loaded'); } catch { /* ignore */ }
    return;
  }

  const dirName = state.currentProjectDir || pathToDirName(state.currentProjectPath);

  let messages;
  try {
    messages = await getSessionHistory(dirName, state.currentSessionId);
  } catch (err: any) {
    const msg = err.code === 'ENOENT'
      ? 'Session file not found — may have been cleaned up'
      : 'Could not read session file';
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery(msg); } catch { /* ignore */ }
    } else {
      await ctx.reply(msg);
    }
    return;
  }

  if (messages.length === 0) {
    try { await ctx.answerCallbackQuery('No messages found'); } catch { /* ignore */ }
    return;
  }

  const pageData = paginate(messages, page, HISTORY_PAGE_SIZE);
  const firstMsgIndex = pageData.page * HISTORY_PAGE_SIZE;

  let text = `<b>📜 Session History</b> (${pageData.totalItems} messages)\n\n`;

  for (let i = 0; i < pageData.items.length; i++) {
    const msg = pageData.items[i];
    const num = firstMsgIndex + i + 1;
    const icon = msg.role === 'user' ? '👤' : '🤖';
    let content = msg.text;
    if (content.length > MSG_TRUNCATE_LEN) {
      content = content.substring(0, MSG_TRUNCATE_LEN) + '…';
    }
    text += `<b>#${num}</b> ${icon} <b>${msg.role === 'user' ? 'You' : 'Claude'}:</b>\n${escapeHtml(content)}\n\n`;
  }

  // Trim to stay under Telegram limit
  if (text.length > 4000) {
    text = text.substring(0, 3990) + '\n…';
  }

  const roles = pageData.items.map(m => m.role);
  const kb = historyKeyboard(pageData.page, pageData.totalPages, firstMsgIndex, roles);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

export async function handleHistoryCommand(ctx: Context): Promise<void> {
  if (!state.currentProjectPath || !state.currentSessionId) {
    await ctx.reply('No session loaded. Use /resume to select one.');
    return;
  }
  await handleSessionHistory(ctx, 0);
}

export async function handleRewindSession(ctx: Context, messageIndex: number): Promise<void> {
  if (!state.currentProjectPath || !state.currentSessionId) {
    try { await ctx.answerCallbackQuery('No session loaded'); } catch { /* ignore */ }
    return;
  }

  const dirName = state.currentProjectDir || pathToDirName(state.currentProjectPath);

  try {
    await rewindSessionTo(dirName, state.currentSessionId, messageIndex);

    await ctx.editMessageText(
      `<b>⏪ Session rewound</b>\n\n` +
      `Rewound to message ${messageIndex + 1}. Send a message to continue from this point.`,
      { parse_mode: 'HTML' }
    );
  } catch (err: any) {
    const msg = err.code === 'ENOENT'
      ? 'Session file not found'
      : 'Failed to rewind session';
    try { await ctx.answerCallbackQuery(msg); } catch { /* ignore */ }
  }
}

function pathToDirName(path: string): string {
  return '-' + path.substring(1).replace(/\//g, '-');
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function checkPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
