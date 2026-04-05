const MAX_MESSAGE_LENGTH = 4096;
const SPLIT_THRESHOLD = 3800;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert a single chunk of markdown to Telegram HTML.
 * Only handles code blocks and inline code (safe, unambiguous conversions).
 */
function markdownToTelegramHtml(text: string): string {
  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const codeBlockStart = remaining.indexOf('```');
    if (codeBlockStart === -1) {
      parts.push(convertInline(escapeHtml(remaining)));
      break;
    }

    if (codeBlockStart > 0) {
      parts.push(convertInline(escapeHtml(remaining.substring(0, codeBlockStart))));
    }

    const afterOpening = codeBlockStart + 3;
    const codeBlockEnd = remaining.indexOf('```', afterOpening);

    if (codeBlockEnd === -1) {
      let code = remaining.substring(afterOpening);
      code = stripLangId(code);
      parts.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
      remaining = '';
    } else {
      let code = remaining.substring(afterOpening, codeBlockEnd);
      code = stripLangId(code);
      parts.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
      remaining = remaining.substring(codeBlockEnd + 3);
    }
  }

  return parts.join('');
}

function stripLangId(code: string): string {
  const nl = code.indexOf('\n');
  if (nl !== -1 && nl < 20 && /^[a-zA-Z]*$/.test(code.substring(0, nl).trim())) {
    return code.substring(nl + 1);
  }
  return code;
}

/**
 * Convert inline markdown formatting to Telegram HTML.
 * Applied to non-code-block text that is already HTML-escaped.
 */
function convertInline(text: string): string {
  // Markdown headers → bold (## Header, ### Header, etc.)
  text = text.replace(/^(#{1,6})\s+(.+)$/gm, '<b>$2</b>');

  // Inline code: `text` (must come before bold/italic to avoid conflicts)
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **text** or __text__ (non-greedy, same-line only)
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__([^_\n]+?)__/g, '<b>$1</b>');

  // Strikethrough: ~~text~~
  text = text.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');

  // Italic: *text* (single asterisk, not inside bold)
  text = text.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<i>$1</i>');

  return text;
}

/**
 * Split raw text into chunks that fit Telegram's 4096 char limit.
 * Splits at natural boundaries (newlines, then spaces).
 */
function splitText(text: string, threshold: number = SPLIT_THRESHOLD): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n', threshold);
    if (splitAt < threshold * 0.5) {
      splitAt = remaining.lastIndexOf(' ', threshold);
    }
    if (splitAt < threshold * 0.5) {
      splitAt = threshold;
    }

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}

export interface FormattedMessage {
  text: string;
  parseMode: 'HTML' | undefined;
}

/**
 * Format the final result for Telegram.
 * Splits raw text FIRST, then converts each chunk to HTML independently.
 * This prevents splitting mid-HTML-tag.
 */
export function formatForTelegram(text: string): FormattedMessage[] {
  const trimmed = text.trim();
  const rawChunks = splitText(trimmed);

  return rawChunks.map(chunk => {
    try {
      const html = markdownToTelegramHtml(chunk);
      // Only use HTML if it fits (HTML tags add length)
      if (html.length <= MAX_MESSAGE_LENGTH) {
        return { text: html, parseMode: 'HTML' as const };
      }
    } catch { /* fall through */ }

    // Fallback: plain text
    return { text: chunk.substring(0, MAX_MESSAGE_LENGTH), parseMode: undefined };
  });
}

export function formatCostFooter(costUsd: number, durationMs: number): string {
  if (costUsd <= 0) return '';
  return `\n\n💲 $${costUsd.toFixed(4)} | ⏱ ${(durationMs / 1000).toFixed(1)}s`;
}

export function truncateForEdit(text: string, suffix: string = ''): string {
  const maxLen = MAX_MESSAGE_LENGTH - suffix.length - 10;
  if (text.length <= maxLen) return text + suffix;
  return text.substring(0, maxLen) + '\n...' + suffix;
}
