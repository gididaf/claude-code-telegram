import { InlineKeyboard } from 'grammy';
import type { ProjectInfo, SessionInfo } from '../types.js';
import { paginate, type Page } from './paginator.js';

export function projectListKeyboard(projects: ProjectInfo[], page: number): { keyboard: InlineKeyboard; pageInfo: Page<ProjectInfo> } {
  const pageData = paginate(projects, page, 8);
  const kb = new InlineKeyboard();

  for (const project of pageData.items) {
    const idx = projects.indexOf(project);
    const label = `${project.displayName} (${project.sessionCount})`;
    kb.text(label, `ps:${idx}`).row();
  }

  // Navigation row
  const navRow: Array<{ text: string; data: string }> = [];
  if (pageData.page > 0) {
    navRow.push({ text: '◀ Prev', data: `p:${pageData.page - 1}` });
  }
  if (pageData.totalPages > 1) {
    navRow.push({ text: `${pageData.page + 1}/${pageData.totalPages}`, data: 'noop' });
  }
  if (pageData.page < pageData.totalPages - 1) {
    navRow.push({ text: 'Next ▶', data: `p:${pageData.page + 1}` });
  }
  for (const btn of navRow) {
    kb.text(btn.text, btn.data);
  }

  return { keyboard: kb, pageInfo: pageData };
}

export function projectMenuKeyboard(projectIndex: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('▶ Resume Last Session', `pr:${projectIndex}`).row()
    .text('📋 Browse Sessions', `sl:${projectIndex}:0`).row()
    .text('✨ New Session', `sn:${projectIndex}`).row()
    .text('◀ Back to Projects', 'p:0');
}

export function sessionListKeyboard(
  sessions: SessionInfo[],
  projectIndex: number,
  page: number
): { keyboard: InlineKeyboard; pageInfo: Page<SessionInfo> } {
  const pageData = paginate(sessions, page, 6);
  const kb = new InlineKeyboard();

  for (const session of pageData.items) {
    const idx = sessions.indexOf(session);
    const label = truncLabel(session.summary, 40) + ` (${session.messageCount} msgs)`;
    kb.text(label, `ss:${projectIndex}:${idx}`).row();
  }

  // Navigation row
  const navRow: Array<{ text: string; data: string }> = [];
  if (pageData.page > 0) {
    navRow.push({ text: '◀ Prev', data: `sl:${projectIndex}:${pageData.page - 1}` });
  }
  if (pageData.totalPages > 1) {
    navRow.push({ text: `${pageData.page + 1}/${pageData.totalPages}`, data: 'noop' });
  }
  if (pageData.page < pageData.totalPages - 1) {
    navRow.push({ text: 'Next ▶', data: `sl:${projectIndex}:${pageData.page + 1}` });
  }
  for (const btn of navRow) {
    kb.text(btn.text, btn.data);
  }
  if (navRow.length > 0) kb.row();

  kb.text('✨ New Session', `sn:${projectIndex}`)
    .text('◀ Back', `ps:${projectIndex}`);

  return { keyboard: kb, pageInfo: pageData };
}

export function sessionListKeyboardByDir(
  sessions: SessionInfo[],
  page: number
): { keyboard: InlineKeyboard; pageInfo: Page<SessionInfo> } {
  const pageData = paginate(sessions, page, 6);
  const kb = new InlineKeyboard();

  for (const session of pageData.items) {
    const idx = sessions.indexOf(session);
    const label = truncLabel(session.summary, 40) + ` (${session.messageCount} msgs)`;
    kb.text(label, `ssc:${idx}`).row();
  }

  const navRow: Array<{ text: string; data: string }> = [];
  if (pageData.page > 0) {
    navRow.push({ text: '◀ Prev', data: `slc:${pageData.page - 1}` });
  }
  if (pageData.totalPages > 1) {
    navRow.push({ text: `${pageData.page + 1}/${pageData.totalPages}`, data: 'noop' });
  }
  if (pageData.page < pageData.totalPages - 1) {
    navRow.push({ text: 'Next ▶', data: `slc:${pageData.page + 1}` });
  }
  for (const btn of navRow) {
    kb.text(btn.text, btn.data);
  }
  if (navRow.length > 0) kb.row();

  kb.text('✨ New Session', 'snc');

  return { keyboard: kb, pageInfo: pageData };
}

export function startKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📂 Browse Projects', 'p:0')
    .text('🆕 New Project', 'new');
}

export function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('✋ Cancel', 'cancel');
}

function truncLabel(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '…';
}
