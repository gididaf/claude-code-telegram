import type { Context } from 'grammy';
import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { runClaude } from '../services/claude.js';
import { state, resetProcessState } from '../state/session-state.js';
import { config } from '../config.js';
import { formatForTelegram, formatCostFooter, truncateForEdit, type FormattedMessage } from '../ui/formatter.js';
import { cancelKeyboard, queueCancelKeyboard, questionKeyboard, planKeyboard } from '../ui/keyboards.js';
import { handleFolderNameInput } from './newproject.js';
import { downloadTelegramFile } from '../services/telegram-files.js';
import { transcribeVoice, isVoiceSupported, resetCapabilities, WhisperError } from '../services/whisper.js';
import type { QuestionData } from '../state/session-state.js';

export async function handleChat(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  // Check if we're waiting for a folder name
  if (await handleFolderNameInput(ctx)) return;

  await routeMessage(ctx, text);
}

// --- Media group (album) batching ---

interface PendingMediaGroup {
  files: Array<{ fileId: string; fileName?: string; typeLabel: string }>;
  caption: string;
  ctx: Context; // use the first message's context for routing
  timer: ReturnType<typeof setTimeout>;
}

const mediaGroups = new Map<string, PendingMediaGroup>();
const MEDIA_GROUP_WAIT_MS = 500;

export async function handleAttachment(ctx: Context): Promise<void> {
  const file = extractFileInfo(ctx);
  if (!file) {
    await ctx.reply('Unsupported attachment type. Send a photo or document.');
    return;
  }

  const mediaGroupId = ctx.message?.media_group_id;

  if (mediaGroupId) {
    // Part of an album — buffer it
    let group = mediaGroups.get(mediaGroupId);
    if (group) {
      group.files.push(file);
      if (ctx.message?.caption) group.caption = ctx.message.caption;
      clearTimeout(group.timer);
    } else {
      group = {
        files: [file],
        caption: ctx.message?.caption || '',
        ctx,
        timer: null as any,
      };
      mediaGroups.set(mediaGroupId, group);
    }
    group.timer = setTimeout(() => flushMediaGroup(mediaGroupId), MEDIA_GROUP_WAIT_MS);
    return;
  }

  // Single attachment — process immediately
  await processSingleAttachment(ctx, file, ctx.message?.caption || '');
}

export async function handleVoice(ctx: Context): Promise<void> {
  const voice = ctx.message?.voice;
  if (!voice) return;

  const supported = await isVoiceSupported();
  if (!supported) {
    const kb = new InlineKeyboard().text('📦 Install whisper.cpp', 'wi');
    await ctx.reply(
      '🎤 Voice messages require whisper.cpp (not installed).\n\n' +
      'Want Claude to install it for you? (~150MB download)',
      { reply_markup: kb },
    );
    return;
  }

  // Show brief indicator while transcribing
  const indicator = await ctx.reply('\u{1F3A4} Transcribing...');

  let text: string;
  try {
    const oggPath = await downloadTelegramFile(ctx.api, voice.file_id, `voice_${voice.file_unique_id}.ogg`);
    text = await transcribeVoice(oggPath);
  } catch (err: any) {
    const msg = err instanceof WhisperError
      ? `Voice transcription failed: ${err.message}`
      : `Voice error: ${err.message}`;
    try { await ctx.api.editMessageText(ctx.chat!.id, indicator.message_id, msg); } catch { /* ignore */ }
    return;
  }

  if (!text) {
    try { await ctx.api.editMessageText(ctx.chat!.id, indicator.message_id, 'Could not transcribe voice message (empty result).'); } catch { /* ignore */ }
    return;
  }

  // Show transcribed text so the user can see what was detected
  try { await ctx.api.editMessageText(ctx.chat!.id, indicator.message_id, `\u{1F3A4} ${text}`); } catch { /* ignore */ }

  await routeMessage(ctx, text);
}

export async function handleWhisperInstall(ctx: Context): Promise<void> {
  resetCapabilities();
  const installPrompt =
    'I need whisper.cpp installed for voice transcription. ' +
    'Install whisper-cpp via Homebrew (brew install whisper-cpp) and download the base GGML model: ' +
    'mkdir -p ~/.local/share/whisper-models && ' +
    'curl -L -o ~/.local/share/whisper-models/ggml-base.bin ' +
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin — ' +
    'Also install ffmpeg if not already present (brew install ffmpeg). ' +
    'Be brief, just run the commands.';
  await routeMessage(ctx, installPrompt);
}

function extractFileInfo(ctx: Context): { fileId: string; fileName?: string; typeLabel: string } | null {
  if (ctx.message?.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    return { fileId: photo.file_id, typeLabel: 'image' };
  }
  if (ctx.message?.document) {
    return {
      fileId: ctx.message.document.file_id,
      fileName: ctx.message.document.file_name || undefined,
      typeLabel: 'file',
    };
  }
  return null;
}

async function processSingleAttachment(ctx: Context, file: { fileId: string; fileName?: string; typeLabel: string }, caption: string): Promise<void> {
  let localPath: string;
  try {
    localPath = await downloadTelegramFile(ctx.api, file.fileId, file.fileName);
  } catch (err: any) {
    await ctx.reply(`Failed to download attachment: ${err.message}`);
    return;
  }

  const prompt = caption
    ? `[Attached ${file.typeLabel}: ${localPath}]\n\n${caption}`
    : `[Attached ${file.typeLabel}: ${localPath}]\n\nPlease analyze this ${file.typeLabel}.`;

  await routeMessage(ctx, prompt);
}

async function flushMediaGroup(mediaGroupId: string): Promise<void> {
  const group = mediaGroups.get(mediaGroupId);
  mediaGroups.delete(mediaGroupId);
  if (!group) return;

  const paths: string[] = [];
  for (const file of group.files) {
    try {
      const localPath = await downloadTelegramFile(group.ctx.api, file.fileId, file.fileName);
      paths.push(`[Attached ${file.typeLabel}: ${localPath}]`);
    } catch (err: any) {
      console.error('Failed to download media group file:', err.message);
    }
  }

  if (paths.length === 0) {
    try { await group.ctx.reply('Failed to download attachments.'); } catch { /* ignore */ }
    return;
  }

  const header = paths.join('\n');
  const prompt = group.caption
    ? `${header}\n\n${group.caption}`
    : `${header}\n\nPlease analyze these ${paths.length} attachments.`;

  await routeMessage(group.ctx, prompt);
}

async function routeMessage(ctx: Context, text: string): Promise<void> {
  if (state.pendingQuestion) {
    await handleQuestionTextAnswer(ctx.api, ctx.chat!.id, text);
    return;
  }

  if (state.isProcessing) {
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await queueMessage(ctx.api, ctx.chat!.id, text);
    return;
  }

  if (!state.currentProjectPath) {
    await ctx.reply(
      'No project selected. Use /projects to pick or create one.\n\n' +
      'Or set DEFAULT_PROJECT_PATH in your .env file.'
    );
    return;
  }

  await processPrompt(ctx.api, ctx.chat!.id, text);
}

async function queueMessage(api: Api, chatId: number, text: string): Promise<void> {
  const truncated = text.length > 200 ? text.substring(0, 200) + '…' : text;
  const display = `📝 ${escapeHtml(truncated)}\n\n⏳ <i>Queued — will send when Claude finishes</i>`;

  if (state.queuedMessageId && state.queuedChatId) {
    // Replace existing queued message
    state.queuedMessage = text;
    try {
      await api.editMessageText(chatId, state.queuedMessageId, display, {
        parse_mode: 'HTML',
        reply_markup: queueCancelKeyboard(),
      });
      return;
    } catch {
      // Edit failed — fall through to send new
    }
  }

  state.queuedMessage = text;
  const msg = await api.sendMessage(chatId, display, {
    parse_mode: 'HTML',
    reply_markup: queueCancelKeyboard(),
  });
  state.queuedMessageId = msg.message_id;
  state.queuedChatId = chatId;
}

export async function drainQueue(api: Api, chatId: number): Promise<void> {
  if (!state.queuedMessage) return;

  const text = state.queuedMessage;
  const msgId = state.queuedMessageId;

  state.queuedMessage = null;
  state.queuedMessageId = null;
  state.queuedChatId = null;

  // Replace the queue notification with the user's message so it looks like normal chat
  if (msgId) {
    const display = text.length > 4000 ? text.substring(0, 4000) + '…' : text;
    try {
      await api.editMessageText(chatId, msgId, `💬 ${display}`);
    } catch {
      try { await api.deleteMessage(chatId, msgId); } catch { /* ignore */ }
    }
  }

  await processPrompt(api, chatId, text);
}

export async function processPrompt(api: Api, chatId: number, text: string): Promise<void> {
  state.isProcessing = true;
  state.accumulatedText = '';

  const thinkingMsg = await api.sendMessage(chatId, '⏳ Thinking...', { reply_markup: cancelKeyboard() });
  state.lastResponseMessageId = thinkingMsg.message_id;
  state.lastResponseChatId = chatId;

  const claude = runClaude({
    prompt: text,
    cwd: state.currentProjectPath!,
    resumeSessionId: state.currentSessionId || undefined,
  });

  state.runningClaude = claude;

  let lastEditTime = 0;
  let editTimer: ReturnType<typeof setTimeout> | null = null;
  let currentMessageIds: number[] = [thinkingMsg.message_id];
  let sentChunks = 0;
  let planCreatedThisRun = false;

  const doEdit = async () => {
    if (!state.accumulatedText || !state.isProcessing) return;

    const displayText = truncateForEdit(state.accumulatedText, '\n\n⏳ ...');
    const targetMsgId = currentMessageIds[currentMessageIds.length - 1];

    try {
      await api.editMessageText(
        chatId,
        targetMsgId,
        displayText,
        { reply_markup: cancelKeyboard() }
      );
      lastEditTime = Date.now();
    } catch (err: any) {
      // "message is not modified" is fine — just means no new text yet
      if (!err.message?.includes('message is not modified')) {
        console.error('Edit error:', err.message);
      }
    }
  };

  const scheduleEdit = () => {
    if (editTimer) return;
    const elapsed = Date.now() - lastEditTime;
    const delay = Math.max(0, config.streamUpdateIntervalMs - elapsed);
    editTimer = setTimeout(async () => {
      editTimer = null;
      await doEdit();
    }, delay);
  };

  claude.on('init', (sessionId) => {
    state.currentSessionId = sessionId;
  });

  claude.on('text-delta', (_delta) => {
    scheduleEdit();
  });

  claude.on('ask-user', (questions) => {
    state.pendingQuestion = {
      questions,
      currentIndex: 0,
      answers: {},
      selectedOptions: new Set(),
      messageId: null,
      chatId: chatId,
    };
  });

  claude.on('plan-created', (planFilePath) => {
    state.currentPlanPath = planFilePath;
    planCreatedThisRun = true;
  });

  claude.on('tool-use', (toolName, detail) => {
    const info = detail ? `${toolName}: ${detail}` : toolName;
    state.accumulatedText += `\n🔧 ${info}\n`;
    scheduleEdit();
  });

  claude.on('tool-result', (toolName, lineCount, isError) => {
    const icon = isError ? '❌' : '✅';
    const lines = lineCount > 0 ? ` (${lineCount} lines)` : '';

    // Replace the first unreplaced 🔧 line for this tool with the result
    const marker = `🔧 ${toolName}`;
    const idx = state.accumulatedText.indexOf(marker);
    if (idx !== -1) {
      const lineEnd = state.accumulatedText.indexOf('\n', idx);
      const oldLine = lineEnd !== -1
        ? state.accumulatedText.substring(idx, lineEnd)
        : state.accumulatedText.substring(idx);
      const newLine = oldLine.replace('🔧', icon) + lines;
      state.accumulatedText = lineEnd !== -1
        ? state.accumulatedText.substring(0, idx) + newLine + state.accumulatedText.substring(lineEnd)
        : state.accumulatedText.substring(0, idx) + newLine;
    } else {
      // Fallback: append as separate line
      state.accumulatedText += `${icon} ${toolName}${lines}\n`;
    }
    scheduleEdit();
  });

  claude.on('result', async (resultText, sessionId, durationMs, contextPercent) => {
    if (editTimer) {
      clearTimeout(editTimer);
      editTimer = null;
    }

    state.currentSessionId = sessionId;

    // If cancelled, just capture session ID — messages already handled by cancel callback
    if (!state.isProcessing) return;

    const finalText = resultText || state.accumulatedText || '(empty response)';
    const costFooter = formatCostFooter(durationMs, contextPercent);
    const chunks = formatForTelegram(finalText);
    const firstMsgId = currentMessageIds[currentMessageIds.length - 1];

    // Helper: try HTML, then plain text, then new message as last resort
    const editOrSend = async (text: string, parseMode: 'HTML' | undefined, editMsgId: number | null, append: string) => {
      const content = text + append;
      // Try with parse mode
      if (parseMode) {
        try {
          if (editMsgId) {
            await api.editMessageText(chatId, editMsgId, content, { parse_mode: parseMode });
          } else {
            await api.sendMessage(chatId, content, { parse_mode: parseMode });
          }
          return;
        } catch (err: any) {
          console.error('HTML send failed, falling back to plain text:', err.message);
        }
      }

      // Plain text (no parse_mode)
      const plain = text.substring(0, 4000 - append.length) + append;
      try {
        if (editMsgId) {
          await api.editMessageText(chatId, editMsgId, plain);
        } else {
          await api.sendMessage(chatId, plain);
        }
      } catch (err: any) {
        console.error('Plain text edit failed, sending as new message:', err.message);
        // Last resort: send as a new message
        if (editMsgId) {
          await api.sendMessage(chatId, plain);
        }
      }
    };

    try {
      // First chunk replaces the streaming message
      const isOnly = chunks.length === 1;
      await editOrSend(chunks[0].text, chunks[0].parseMode, firstMsgId, isOnly ? costFooter : '');

      // Remaining chunks as new messages
      for (let i = 1; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        await editOrSend(chunks[i].text, chunks[i].parseMode, null, isLast ? costFooter : '');
      }
    } catch (err: any) {
      console.error('Failed to send final message:', err.message);
      try { await api.sendMessage(chatId, finalText.substring(0, 4000)); } catch { /* ignore */ }
    }

    resetProcessState();

    // Show pending question from AskUserQuestion if any
    if (state.pendingQuestion) {
      await showCurrentQuestion(api, chatId);
      return; // don't drain queue — wait for answer
    }

    // Show plan action buttons if a plan was created during this run
    if (planCreatedThisRun && state.currentPlanPath) {
      const planName = state.currentPlanPath.split('/').pop() || 'plan.md';
      try {
        await api.sendMessage(
          chatId,
          `📋 <b>Plan created:</b> <code>${escapeHtml(planName)}</code>`,
          { parse_mode: 'HTML', reply_markup: planKeyboard() }
        );
      } catch { /* ignore */ }
      return; // don't drain queue — wait for user to approve/discard
    }

    await drainQueue(api, chatId);
  });

  claude.on('error', async (errorMsg) => {
    if (editTimer) {
      clearTimeout(editTimer);
      editTimer = null;
    }

    // If cancelled, skip — messages already handled by cancel callback
    if (!state.isProcessing) return;

    try {
      await api.editMessageText(
        chatId,
        currentMessageIds[currentMessageIds.length - 1],
        `❌ Error: ${errorMsg}`
      );
    } catch {
      try { await api.sendMessage(chatId, `❌ Error: ${errorMsg}`); } catch { /* ignore */ }
    }
    resetProcessState();
    await drainQueue(api, chatId);
  });
}

export async function showCurrentQuestion(api: Api, chatId: number): Promise<void> {
  const pq = state.pendingQuestion;
  if (!pq) return;

  const q = pq.questions[pq.currentIndex];
  const kb = questionKeyboard(q.options, q.multiSelect, pq.selectedOptions);

  let text = `❓ <b>${escapeHtml(q.header)}</b>\n${escapeHtml(q.question)}`;
  for (const opt of q.options) {
    text += `\n• <b>${escapeHtml(opt.label)}</b> — ${escapeHtml(opt.description)}`;
  }
  text += q.multiSelect
    ? '\n\n<i>Select options and tap Submit.\nYou can also send a text message to add a custom answer.</i>'
    : '\n\n<i>Tap an option or send a text message instead.</i>';

  const msg = await api.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: kb,
  });
  pq.messageId = msg.message_id;
  pq.chatId = chatId;
}

export async function submitQuestionAnswers(api: Api, chatId: number): Promise<void> {
  const pq = state.pendingQuestion!;
  state.pendingQuestion = null;

  const entries = Object.entries(pq.answers);
  let prompt: string;
  if (entries.length === 1) {
    prompt = entries[0][1];
  } else {
    prompt = entries.map(([q, a]) => `${q}\n${a}`).join('\n\n');
  }

  await processPrompt(api, chatId, prompt);
}

async function handleQuestionTextAnswer(api: Api, chatId: number, text: string): Promise<void> {
  const pq = state.pendingQuestion!;
  const q = pq.questions[pq.currentIndex];

  // Combine any already-checked options with the typed text
  const checked = [...pq.selectedOptions].sort((a, b) => a - b)
    .map(i => q.options[i]?.label).filter(Boolean);
  const answer = checked.length > 0
    ? `Selected: ${checked.join(', ')}\nAdditional input: ${text}`
    : text;
  pq.answers[q.question] = answer;

  // Remove the question keyboard
  if (pq.messageId) {
    try {
      await api.editMessageReplyMarkup(chatId, pq.messageId, { reply_markup: undefined });
    } catch { /* ignore */ }
  }

  if (pq.currentIndex < pq.questions.length - 1) {
    pq.currentIndex++;
    pq.selectedOptions.clear();
    await showCurrentQuestion(api, chatId);
  } else {
    await submitQuestionAnswers(api, chatId);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
