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
  if (navRow.length > 0) kb.row();

  kb.text('📁 New from Directory', 'newdir');

  return { keyboard: kb, pageInfo: pageData };
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

  kb.text('◀ Back', `ps:${projectIndex}`);

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

  return { keyboard: kb, pageInfo: pageData };
}

export function historyKeyboard(
  page: number,
  totalPages: number,
  firstMsgIndex: number,
  roles: Array<'user' | 'assistant'>,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Rewind buttons — only for assistant (Claude) messages
  let btnCount = 0;
  for (let i = 0; i < roles.length; i++) {
    if (roles[i] !== 'assistant') continue;
    const globalIdx = firstMsgIndex + i;
    kb.text(`⏪ Rewind to #${globalIdx + 1}`, `sr:${globalIdx}`);
    btnCount++;
    if (btnCount % 2 === 0) kb.row();
  }
  if (btnCount > 0 && btnCount % 2 !== 0) kb.row();

  const navRow: Array<{ text: string; data: string }> = [];
  if (page > 0) {
    navRow.push({ text: '◀ Newer', data: `sh:${page - 1}` });
  }
  if (totalPages > 1) {
    navRow.push({ text: `${page + 1}/${totalPages}`, data: 'noop' });
  }
  if (page < totalPages - 1) {
    navRow.push({ text: 'Older ▶', data: `sh:${page + 1}` });
  }
  for (const btn of navRow) {
    kb.text(btn.text, btn.data);
  }

  return kb;
}

export function startKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📂 Projects', 'p:0')
    .text('✨ New Session', 'new');
}

export function questionKeyboard(
  options: Array<{ label: string; description: string }>,
  multiSelect: boolean,
  selectedOptions?: Set<number>,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (let i = 0; i < options.length; i++) {
    if (multiSelect) {
      const check = selectedOptions?.has(i) ? '☑' : '☐';
      kb.text(`${check} ${options[i].label}`, `at:${i}`).row();
    } else {
      kb.text(options[i].label, `aq:${i}`).row();
    }
  }

  if (multiSelect) {
    const count = selectedOptions?.size || 0;
    kb.text(`✅ Submit${count > 0 ? ` (${count})` : ''}`, 'as').row();
  }

  return kb;
}

export function planKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Implement', 'pi')
    .text('📋 View Plan', 'pv')
    .row()
    .text('✏️ Refine', 'pr');
}

export function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('✋ Cancel', 'cancel');
}

export function queueCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('❌ Cancel', 'cq');
}

function truncLabel(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '…';
}
