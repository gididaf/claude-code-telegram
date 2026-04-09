import type { Context } from 'grammy';
import { exec } from 'child_process';
import { state } from '../state/session-state.js';

export async function handleBash(ctx: Context): Promise<void> {
  const text = ctx.message?.text || '';
  const cmd = text.replace(/^\/bash\s*/, '');

  if (!cmd) {
    await ctx.reply('Usage: /bash <command>\nExample: /bash ls -la');
    return;
  }

  const cwd = state.currentProjectPath || process.cwd();
  const msg = await ctx.reply(`⚡ Running...\n<code>${escapeHtml(cmd)}</code>`, { parse_mode: 'HTML' });

  exec(cmd, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 }, async (_err, stdout, stderr) => {
    const output = (stdout + stderr).trim();
    const display = output
      ? escapeHtml(output.length > 3900 ? output.substring(0, 3900) + '\n...' : output)
      : '(no output)';

    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        msg.message_id,
        `<code>$ ${escapeHtml(cmd)}</code>\n\n<pre>${display}</pre>`,
        { parse_mode: 'HTML' }
      );
    } catch {
      await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `$ ${cmd}\n\n${output || '(no output)'}`);
    }
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
