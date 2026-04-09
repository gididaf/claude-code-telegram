import type { Context } from 'grammy';
import type { Api } from 'grammy';
import { exec } from 'child_process';
import { InlineKeyboard } from 'grammy';
import { state, type DiffFile } from '../state/session-state.js';

function execAsync(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 15000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
      if (err && (err.killed || err.signal)) {
        resolve({ stdout: '', stderr: err.message });
      } else {
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseNumstat(output: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of output.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length >= 3) {
      files.push({
        path: parts.slice(2).join('\t'), // handle paths with tabs (rare)
        added: parts[0],
        removed: parts[1],
        untracked: false,
      });
    }
  }
  return files;
}

function diffFileKeyboard(files: DiffFile[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let stat: string;
    if (f.untracked) {
      stat = 'new';
    } else if (f.added === '-') {
      stat = 'binary';
    } else {
      const parts = [];
      if (f.added !== '0') parts.push(`+${f.added}`);
      if (f.removed !== '0') parts.push(`-${f.removed}`);
      stat = parts.join(' ') || '±0';
    }
    kb.text(`${f.path}  (${stat})`, `df:${i}`).row();
  }
  return kb;
}

export async function handleDiff(ctx: Context): Promise<void> {
  const args = (ctx.message?.text || '').replace(/^\/diff\s*/, '').trim();
  const cwd = state.currentProjectPath;

  if (!cwd) {
    await ctx.reply('No project selected. Use /projects to pick or create one.');
    return;
  }

  const chatId = ctx.chat!.id;
  const msg = await ctx.reply('⏳ Loading diff...');

  try {
    let files: DiffFile[];
    let summary: string;

    if (args) {
      // Pass-through mode
      const { stdout, stderr } = await execAsync(`git -c color.diff=never diff --numstat ${args}`, cwd);
      if (stderr && !stdout) {
        await ctx.api.editMessageText(chatId, msg.message_id, `❌ ${escapeHtml(stderr.trim())}`, { parse_mode: 'HTML' });
        return;
      }
      files = parseNumstat(stdout);
      state.diffArgs = args;
      const totalAdded = files.reduce((s, f) => s + (parseInt(f.added) || 0), 0);
      const totalRemoved = files.reduce((s, f) => s + (parseInt(f.removed) || 0), 0);
      summary = `<b>📊 git diff ${escapeHtml(args)}</b>\n${files.length} files`;
      if (totalAdded || totalRemoved) summary += `, <b>+${totalAdded} -${totalRemoved}</b>`;
    } else {
      // Default: all changes
      let [numstatResult, untrackedResult] = await Promise.all([
        execAsync('git -c color.diff=never diff --numstat HEAD', cwd),
        execAsync('git ls-files --others --exclude-standard', cwd),
      ]);

      // Fallback if HEAD doesn't exist
      if (numstatResult.stderr.includes('unknown revision')) {
        const [unstaged, staged] = await Promise.all([
          execAsync('git -c color.diff=never diff --numstat', cwd),
          execAsync('git -c color.diff=never diff --numstat --cached', cwd),
        ]);
        numstatResult = { stdout: unstaged.stdout + staged.stdout, stderr: '' };
      }

      files = parseNumstat(numstatResult.stdout);
      state.diffArgs = null;

      // Add untracked files
      const untracked = untrackedResult.stdout.trim();
      if (untracked) {
        for (const path of untracked.split('\n')) {
          if (path) files.push({ path, added: '0', removed: '0', untracked: true });
        }
      }

      if (files.length === 0) {
        await ctx.api.editMessageText(chatId, msg.message_id, '✅ Working tree clean.');
        return;
      }

      const tracked = files.filter(f => !f.untracked);
      const untrackedCount = files.filter(f => f.untracked).length;
      const totalAdded = tracked.reduce((s, f) => s + (parseInt(f.added) || 0), 0);
      const totalRemoved = tracked.reduce((s, f) => s + (parseInt(f.removed) || 0), 0);

      summary = `<b>📊 Uncommitted changes</b>\n`;
      if (tracked.length > 0) {
        summary += `${tracked.length} files changed, <b>+${totalAdded} -${totalRemoved}</b>`;
      }
      if (untrackedCount > 0) {
        summary += tracked.length > 0 ? '\n' : '';
        summary += `${untrackedCount} untracked`;
      }
    }

    if (files.length === 0) {
      await ctx.api.editMessageText(chatId, msg.message_id, 'No changes found.');
      return;
    }

    state.diffFiles = files;
    summary += '\n\n<i>Tap a file to view its diff:</i>';

    await ctx.api.editMessageText(chatId, msg.message_id, summary, {
      parse_mode: 'HTML',
      reply_markup: diffFileKeyboard(files),
    });
  } catch (err: any) {
    const errMsg = err.message?.includes('maxBuffer')
      ? '❌ Too many files. Try narrowing with arguments, e.g. /diff src/'
      : `❌ ${escapeHtml(err.message || 'Unknown error')}`;
    try {
      await ctx.api.editMessageText(chatId, msg.message_id, errMsg, { parse_mode: 'HTML' });
    } catch {
      await ctx.api.editMessageText(chatId, msg.message_id, errMsg.replace(/<[^>]*>/g, ''));
    }
  }
}

export async function showFileDiff(api: Api, chatId: number, fileIndex: number): Promise<void> {
  const files = state.diffFiles;
  if (!files || fileIndex < 0 || fileIndex >= files.length) return;

  const file = files[fileIndex];
  const cwd = state.currentProjectPath;
  if (!cwd) return;

  let cmd: string;
  if (file.untracked) {
    cmd = `git -c color.diff=never diff --no-index /dev/null ${shellEscape(file.path)}`;
  } else if (state.diffArgs) {
    cmd = `git -c color.diff=never diff ${state.diffArgs} -- ${shellEscape(file.path)}`;
  } else {
    cmd = `git -c color.diff=never diff HEAD -- ${shellEscape(file.path)}`;
  }

  const { stdout, stderr } = await execAsync(cmd, cwd);
  const diffText = stdout.trimEnd() || stderr.trimEnd() || '(empty diff)';

  const chunks = splitPreformatted(diffText);
  for (const chunk of chunks) {
    try {
      await api.sendMessage(chatId, `<pre><code class="language-diff">${chunk}</code></pre>`, { parse_mode: 'HTML' });
    } catch {
      await api.sendMessage(chatId, chunk.substring(0, 4000));
    }
  }
}

function splitPreformatted(text: string, maxChunk: number = 3700): string[] {
  const escaped = escapeHtml(text);
  if (escaped.length <= maxChunk) return [escaped];

  const chunks: string[] = [];
  let remaining = escaped;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunk) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxChunk);
    if (splitAt < maxChunk * 0.5) {
      splitAt = maxChunk;
    }
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt);
  }
  return chunks;
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
