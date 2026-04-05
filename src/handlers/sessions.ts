import { access } from 'fs/promises';
import type { Context } from 'grammy';
import { listProjects, listSessions } from '../services/projects.js';
import { projectMenuKeyboard, sessionListKeyboard } from '../ui/keyboards.js';
import { state } from '../state/session-state.js';

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

  const keyboard = projectMenuKeyboard(projectIndex);
  const warning = pathExists ? '' : '\n\n⚠️ <b>Warning:</b> Directory not found on disk. Sessions can still be browsed but new prompts may fail.';
  const text =
    `<b>📂 ${escapeHtml(project.displayName)}</b>\n` +
    `📍 <code>${escapeHtml(project.originalPath)}</code>\n` +
    `💬 ${project.sessionCount} sessions\n` +
    `🕐 Last active: ${formatDate(project.lastModified)}` +
    warning;

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
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
