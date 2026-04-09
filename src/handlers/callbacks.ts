import type { Context } from 'grammy';
import { handleProjects } from './projects.js';
import {
  handleProjectSelect,
  handleSessionList,
  handleSessionSelect,
  handleResumeLatest,
  handleNewSession,
  handleSessionHistory,
  handleRewindSession,
} from './sessions.js';
import { handleBrowseDirectory, handleDirNavigate, handleDirSelect, handleCreateFolderPrompt } from './newproject.js';
import { decodePath } from '../services/directory-browser.js';
import { listSessions } from '../services/projects.js';
import { sessionListKeyboardByDir } from '../ui/keyboards.js';
import { state, resetProcessState } from '../state/session-state.js';
import { drainQueue, showCurrentQuestion, submitQuestionAnswers, processPrompt, handleWhisperInstall } from './chat.js';
import { showFileDiff } from './diff.js';
import { questionKeyboard } from '../ui/keyboards.js';
import { readFile } from 'fs/promises';
import { formatForTelegram } from '../ui/formatter.js';

export async function handleCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  try {
    // Cancel running process
    if (data === 'cancel') {
      if (!state.isProcessing || !state.runningClaude) {
        await ctx.answerCallbackQuery('Nothing is running.');
        return;
      }
      const accumulated = state.accumulatedText;
      const chatId = ctx.chat!.id;
      state.runningClaude.kill();
      resetProcessState();
      try {
        // Keep the current message with accumulated text, just remove the cancel button
        if (accumulated) {
          const display = accumulated.length > 4050
            ? accumulated.substring(0, 4050) + '\n...'
            : accumulated;
          await ctx.editMessageText(display + '\n\n⚠️ Interrupted');
        } else {
          await ctx.editMessageText('⚠️ Interrupted');
        }
      } catch {
        // Message may already be gone
      }
      // If there's a queued message, auto-send it; otherwise prompt for next action
      if (state.queuedMessage) {
        await drainQueue(ctx.api, chatId);
      } else {
        try {
          await ctx.reply('Interrupted · What should Claude do instead?');
        } catch { /* ignore */ }
      }
      await ctx.answerCallbackQuery('Interrupted');
      return;
    }

    // Cancel queued message
    if (data === 'cq') {
      if (state.queuedMessage) {
        state.queuedMessage = null;
        state.queuedMessageId = null;
        state.queuedChatId = null;
        try { await ctx.editMessageText('❌ Queued message cancelled.'); } catch { /* ignore */ }
      }
      await ctx.answerCallbackQuery('Queue cancelled');
      return;
    }

    // Whisper install
    if (data === 'wi') {
      try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch { /* ignore */ }
      await handleWhisperInstall(ctx);
      await ctx.answerCallbackQuery('Installing...');
      return;
    }

    // Plan: implement
    if (data === 'pi') {
      if (!state.currentPlanPath) {
        await ctx.answerCallbackQuery('No plan found');
        return;
      }
      try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch { /* ignore */ }
      const chatId = ctx.chat!.id;
      await processPrompt(ctx.api, chatId, 'Implement the plan');
      await ctx.answerCallbackQuery('Implementing...');
      return;
    }

    // Plan: view full plan
    if (data === 'pv') {
      if (!state.currentPlanPath) {
        await ctx.answerCallbackQuery('No plan found');
        return;
      }
      try {
        const content = await readFile(state.currentPlanPath, 'utf-8');
        const chunks = formatForTelegram(content);
        for (const chunk of chunks) {
          try {
            await ctx.api.sendMessage(ctx.chat!.id, chunk.text, {
              parse_mode: chunk.parseMode,
            });
          } catch {
            await ctx.api.sendMessage(ctx.chat!.id, chunk.text.substring(0, 4000));
          }
        }
      } catch {
        await ctx.api.sendMessage(ctx.chat!.id, '❌ Could not read plan file.');
      }
      await ctx.answerCallbackQuery();
      return;
    }

    // Plan: refine
    if (data === 'pr') {
      if (!state.currentPlanPath) {
        await ctx.answerCallbackQuery('No plan found');
        return;
      }
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch { /* ignore */ }
      await ctx.api.sendMessage(ctx.chat!.id, '✏️ What should be changed in the plan?');
      await ctx.answerCallbackQuery('Send your feedback');
      return;
    }

    // Answer question — single-select: aq:optionIndex
    if (data.startsWith('aq:')) {
      const optIdx = parseInt(data.substring(3), 10);
      const pq = state.pendingQuestion;
      if (!pq) { await ctx.answerCallbackQuery('No question pending'); return; }
      const q = pq.questions[pq.currentIndex];
      const opt = q.options[optIdx];
      if (!opt) { await ctx.answerCallbackQuery('Invalid option'); return; }
      pq.answers[q.question] = opt.label;
      try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch { /* ignore */ }
      if (pq.currentIndex < pq.questions.length - 1) {
        pq.currentIndex++;
        pq.selectedOptions.clear();
        await showCurrentQuestion(ctx.api, ctx.chat!.id);
      } else {
        await submitQuestionAnswers(ctx.api, ctx.chat!.id);
      }
      await ctx.answerCallbackQuery(opt.label);
      return;
    }

    // Toggle multi-select option: at:optionIndex
    if (data.startsWith('at:')) {
      const optIdx = parseInt(data.substring(3), 10);
      const pq = state.pendingQuestion;
      if (!pq) { await ctx.answerCallbackQuery('No question pending'); return; }
      if (pq.selectedOptions.has(optIdx)) {
        pq.selectedOptions.delete(optIdx);
      } else {
        pq.selectedOptions.add(optIdx);
      }
      const q = pq.questions[pq.currentIndex];
      const kb = questionKeyboard(q.options, q.multiSelect, pq.selectedOptions);
      try { await ctx.editMessageReplyMarkup({ reply_markup: kb }); } catch { /* ignore */ }
      await ctx.answerCallbackQuery();
      return;
    }

    // Submit multi-select answers: as
    if (data === 'as') {
      const pq = state.pendingQuestion;
      if (!pq) { await ctx.answerCallbackQuery('No question pending'); return; }
      const q = pq.questions[pq.currentIndex];
      const labels = [...pq.selectedOptions].sort((a, b) => a - b)
        .map(i => q.options[i]?.label).filter(Boolean);
      if (labels.length === 0) {
        await ctx.answerCallbackQuery('Select at least one option');
        return;
      }
      pq.answers[q.question] = labels.join(', ');
      try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch { /* ignore */ }
      if (pq.currentIndex < pq.questions.length - 1) {
        pq.currentIndex++;
        pq.selectedOptions.clear();
        await showCurrentQuestion(ctx.api, ctx.chat!.id);
      } else {
        await submitQuestionAnswers(ctx.api, ctx.chat!.id);
      }
      await ctx.answerCallbackQuery('Submitted');
      return;
    }

    // Diff: show file diff
    if (data.startsWith('df:')) {
      const idx = parseInt(data.substring(3), 10);
      if (!state.diffFiles) {
        await ctx.answerCallbackQuery('No diff data. Run /diff again.');
        return;
      }
      await showFileDiff(ctx.api, ctx.chat!.id, idx);
      await ctx.answerCallbackQuery();
      return;
    }

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

    // Session rewind: sr:messageIndex
    if (data.startsWith('sr:')) {
      const msgIdx = parseInt(data.substring(3), 10);
      await handleRewindSession(ctx, msgIdx);
      await ctx.answerCallbackQuery();
      return;
    }

    // Session history: sh:page
    if (data.startsWith('sh:')) {
      const page = parseInt(data.substring(3), 10);
      await handleSessionHistory(ctx, page);
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

    // New session (from /start keyboard)
    if (data === 'new') {
      state.currentSessionId = null;
      await ctx.editMessageText(
        `<b>✨ New session</b>\n\nSend a message to start.`,
        { parse_mode: 'HTML' }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    // Browse directory for new project (from /projects keyboard)
    if (data === 'newdir') {
      await handleBrowseDirectory(ctx);
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
