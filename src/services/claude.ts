import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { config } from '../config.js';

export interface ClaudeEvents {
  init: [sessionId: string, model: string];
  'text-delta': [text: string];
  'tool-use': [toolName: string, detail: string];
  'tool-result': [toolName: string, lineCount: number, isError: boolean];
  'assistant-text': [fullText: string];
  'ask-user': [questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }>; multiSelect: boolean }>];
  'plan-created': [planFilePath: string];
  result: [text: string, sessionId: string, durationMs: number, contextPercent: number];
  error: [message: string];
}

function summarizeToolInput(toolName: string, input: any, cwd: string): string {
  if (!input) return '';
  try {
    switch (toolName) {
      case 'Bash':
        return truncDetail(shortenPaths(input.command || input.description || '', cwd));
      case 'Read':
        return truncDetail(shortenPath(input.file_path || '', cwd));
      case 'Write':
        return truncDetail(shortenPath(input.file_path || '', cwd));
      case 'Edit':
        return truncDetail(shortenPath(input.file_path || '', cwd));
      case 'Glob':
        return truncDetail(input.pattern || '');
      case 'Grep':
        return truncDetail(input.pattern || '');
      case 'WebFetch':
        return truncDetail(input.url || '');
      case 'WebSearch':
        return truncDetail(input.query || '');
      case 'Agent':
        return truncDetail(input.description || '');
      case 'AskUserQuestion':
        return truncDetail(input.questions?.[0]?.question || '');
      case 'EnterPlanMode':
        return '';
      case 'ExitPlanMode':
        return '';
      default:
        return '';
    }
  } catch {
    return '';
  }
}

const homeDir = process.env.HOME || process.env.USERPROFILE || '';

/** Shorten a single file path: strip cwd prefix, or replace homedir with ~ */
function shortenPath(filepath: string, cwd: string): string {
  if (!filepath) return '';
  if (cwd && filepath.startsWith(cwd + '/')) {
    return filepath.substring(cwd.length + 1);
  }
  if (cwd && filepath === cwd) {
    return '.';
  }
  if (homeDir && filepath.startsWith(homeDir + '/')) {
    return '~/' + filepath.substring(homeDir.length + 1);
  }
  return filepath;
}

/** Shorten paths embedded in a string (e.g. bash commands) */
function shortenPaths(text: string, cwd: string): string {
  if (!text) return '';
  // Replace cwd first (longer, more specific match)
  if (cwd) {
    text = text.replaceAll(cwd + '/', '');
    text = text.replaceAll(cwd, '.');
  }
  if (homeDir) {
    text = text.replaceAll(homeDir + '/', '~/');
    text = text.replaceAll(homeDir, '~');
  }
  return text;
}

function extractToolResultText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text || '')
      .join('\n');
  }
  return '';
}

function truncDetail(s: string): string {
  if (s.length <= 80) return s;
  return s.substring(0, 77) + '...';
}

export class ClaudeProcess extends EventEmitter<ClaudeEvents> {
  public process: ChildProcess;
  private buffer: string = '';
  private cancelled: boolean = false;
  private cwd: string;
  private toolNames: Map<string, string> = new Map();

  constructor(options: {
    prompt: string;
    cwd: string;
    resumeSessionId?: string;
  }) {
    super();
    this.cwd = options.cwd;

    const args = [
      '-p', options.prompt,
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    if (options.resumeSessionId) {
      args.unshift('-r', options.resumeSessionId);
    }

    this.process = spawn(config.claudeCliPath, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, IS_SANDBOX: '1' },
    });

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        console.error('[claude stderr]', text);
      }
    });

    this.process.on('error', (err) => {
      this.emit('error', `Failed to start claude: ${err.message}`);
    });

    this.process.on('close', (code) => {
      if (this.cancelled) return;
      // Process remaining buffer
      if (this.buffer.trim()) {
        this.processBuffer();
      }
      if (code !== 0 && code !== null) {
        this.emit('error', `Claude process exited with code ${code}`);
      }
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);
        this.handleEvent(event);
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  private handleEvent(event: any): void {
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          this.emit('init', event.session_id, event.model);
        }
        break;

      case 'stream_event':
        this.handleStreamEvent(event.event);
        break;

      case 'assistant':
        if (event.message?.content) {
          const textBlocks = event.message.content.filter(
            (b: any) => b.type === 'text'
          );
          if (textBlocks.length > 0) {
            const fullText = textBlocks.map((b: any) => b.text).join('');
            this.emit('assistant-text', fullText);
          }

          const toolBlocks = event.message.content.filter(
            (b: any) => b.type === 'tool_use'
          );
          for (const tool of toolBlocks) {
            if (tool.id) {
              this.toolNames.set(tool.id, tool.name);
            }
            const detail = summarizeToolInput(tool.name, tool.input, this.cwd);
            this.emit('tool-use', tool.name, detail);
            if (tool.name === 'AskUserQuestion' && tool.input?.questions) {
              this.emit('ask-user', tool.input.questions);
            }
            if (tool.name === 'ExitPlanMode' && tool.input?.planFilePath) {
              this.emit('plan-created', tool.input.planFilePath);
            }
          }
        }
        break;

      case 'user':
        if (event.message?.content) {
          const toolResults = event.message.content.filter(
            (b: any) => b.type === 'tool_result'
          );
          for (const tr of toolResults) {
            const toolName = this.toolNames.get(tr.tool_use_id) || 'Tool';
            const content = extractToolResultText(tr.content);
            const lineCount = content ? content.split('\n').length : 0;
            this.emit('tool-result', toolName, lineCount, !!tr.is_error);
          }
        }
        break;

      case 'result':
        this.emit(
          'result',
          event.result || '',
          event.session_id || '',
          event.duration_ms || 0,
          this.calcContextPercent(event)
        );
        break;
    }
  }

  private handleStreamEvent(streamEvent: any): void {
    if (!streamEvent) return;

    switch (streamEvent.type) {
      case 'content_block_delta':
        if (streamEvent.delta?.type === 'text_delta' && streamEvent.delta.text) {
          this.emit('text-delta', streamEvent.delta.text);
        }
        break;

      // tool_use details are emitted from the 'assistant' event which has full input
        break;
    }
  }

  private calcContextPercent(event: any): number {
    // Extract from modelUsage (has contextWindow)
    const mu = event.modelUsage;
    if (mu) {
      const model = Object.values(mu)[0] as any;
      if (model?.contextWindow) {
        const used = (model.inputTokens || 0) + (model.outputTokens || 0)
          + (model.cacheReadInputTokens || 0) + (model.cacheCreationInputTokens || 0);
        return (used / model.contextWindow) * 100;
      }
    }
    return 0;
  }

  kill(): void {
    this.cancelled = true;
    if (this.process && !this.process.killed) {
      // SIGINT triggers graceful shutdown — CLI saves session state before exiting
      this.process.kill('SIGINT');
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGTERM');
        }
      }, 3000);
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 6000);
    }
  }
}

export function runClaude(options: {
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
}): ClaudeProcess {
  return new ClaudeProcess(options);
}
