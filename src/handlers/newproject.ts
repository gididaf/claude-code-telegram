import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { listDirectories, getParentDir, encodePath, encodeSelect, decodePath } from '../services/directory-browser.js';
import { state } from '../state/session-state.js';
import { paginate } from '../ui/paginator.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function displayPath(fullPath: string): string {
  const home = homedir();
  if (fullPath === home) return '~';
  if (fullPath.startsWith(home + '/')) return '~' + fullPath.substring(home.length);
  return fullPath;
}

export async function handleNewProject(ctx: Context): Promise<void> {
  state.awaitingFolderName = null;
  await showDirectory(ctx, homedir(), 0, false);
}

export async function handleDirNavigate(ctx: Context, callbackData: string, page: number = 0): Promise<void> {
  const path = decodePath(callbackData);
  if (!path) {
    await ctx.answerCallbackQuery('Path expired. Use /new again.');
    return;
  }
  state.awaitingFolderName = null;
  await showDirectory(ctx, path, page, true);
}

export async function handleDirSelect(ctx: Context, callbackData: string): Promise<void> {
  const path = decodePath(callbackData);
  if (!path) {
    await ctx.answerCallbackQuery('Path expired. Use /new again.');
    return;
  }

  state.currentProjectPath = path;
  state.currentProjectDir = null;
  state.currentSessionId = null;
  state.awaitingFolderName = null;

  const text =
    `<b>✅ Project set</b>\n\n` +
    `📍 <code>${escapeHtml(path)}</code>\n\n` +
    `Send a message to start a new Claude Code session in this directory.`;

  await ctx.editMessageText(text, { parse_mode: 'HTML' });
}

export async function handleCreateFolderPrompt(ctx: Context, callbackData: string): Promise<void> {
  const path = decodePath(callbackData);
  if (!path) {
    await ctx.answerCallbackQuery('Path expired. Use /new again.');
    return;
  }

  state.awaitingFolderName = path;

  const text =
    `<b>📁 Create new folder</b>\n\n` +
    `📍 <code>${escapeHtml(displayPath(path))}</code>\n\n` +
    `Type the folder name:`;

  await ctx.editMessageText(text, { parse_mode: 'HTML' });
}

export async function handleFolderNameInput(ctx: Context): Promise<boolean> {
  if (!state.awaitingFolderName) return false;

  const name = ctx.message?.text?.trim();
  if (!name) return false;

  const parentPath = state.awaitingFolderName;
  state.awaitingFolderName = null;

  // Validate folder name
  if (name.includes('/') || name.includes('\\') || name.startsWith('.')) {
    await ctx.reply('Invalid folder name. No slashes or leading dots allowed.');
    return true;
  }

  const newPath = join(parentPath, name);

  try {
    await mkdir(newPath, { recursive: true });
  } catch (err: any) {
    await ctx.reply(`❌ Failed to create folder: ${err.message}`);
    return true;
  }

  // Set as project and confirm
  state.currentProjectPath = newPath;
  state.currentProjectDir = null;
  state.currentSessionId = null;

  const text =
    `<b>✅ Folder created & project set</b>\n\n` +
    `📍 <code>${escapeHtml(newPath)}</code>\n\n` +
    `Send a message to start a new Claude Code session.`;

  await ctx.reply(text, { parse_mode: 'HTML' });
  return true;
}

async function showDirectory(ctx: Context, path: string, page: number, isEdit: boolean): Promise<void> {
  let dirs;
  try {
    dirs = await listDirectories(path);
  } catch {
    const msg = `❌ Cannot read directory: <code>${escapeHtml(path)}</code>`;
    if (isEdit) {
      await ctx.editMessageText(msg, { parse_mode: 'HTML' });
    } else {
      await ctx.reply(msg, { parse_mode: 'HTML' });
    }
    return;
  }

  const kb = new InlineKeyboard();

  // Select this directory button
  kb.text(`✅ SELECT: ${displayPath(path)}`, encodeSelect(path)).row();

  // Create new folder + parent
  const parent = getParentDir(path);
  kb.text('📁 + New Folder', `cf:${encodePath(path).split(':')[1]}`);
  if (parent) {
    kb.text('📁 ..  (parent)', encodePath(parent));
  }
  kb.row();

  // Subdirectories with pagination
  const pageData = paginate(dirs, page, 8);
  for (const dir of pageData.items) {
    kb.text(`📂 ${dir.name}`, encodePath(dir.fullPath)).row();
  }

  // Pagination nav
  if (pageData.totalPages > 1) {
    const navRow: Array<{ text: string; data: string }> = [];
    if (pageData.page > 0) {
      navRow.push({ text: '◀ Prev', data: `dp:${encodePath(path).split(':')[1]}:${pageData.page - 1}` });
    }
    navRow.push({ text: `${pageData.page + 1}/${pageData.totalPages}`, data: 'noop' });
    if (pageData.page < pageData.totalPages - 1) {
      navRow.push({ text: 'Next ▶', data: `dp:${encodePath(path).split(':')[1]}:${pageData.page + 1}` });
    }
    for (const btn of navRow) {
      kb.text(btn.text, btn.data);
    }
  }

  const text = `<b>📂 Browse directories</b>\n\n📍 <code>${escapeHtml(displayPath(path))}</code>`;

  if (isEdit) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}
