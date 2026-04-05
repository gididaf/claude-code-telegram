import type { ClaudeProcess } from '../services/claude.js';
import { config } from '../config.js';

export interface BotState {
  currentProjectPath: string | null;
  currentProjectDir: string | null;
  currentSessionId: string | null;
  runningClaude: ClaudeProcess | null;
  isProcessing: boolean;
  lastResponseMessageId: number | null;
  lastResponseChatId: number | null;
  accumulatedText: string;
  awaitingFolderName: string | null; // parent path when waiting for folder name input
}

export const state: BotState = {
  currentProjectPath: config.defaultProjectPath,
  currentProjectDir: null,
  currentSessionId: null,
  runningClaude: null,
  isProcessing: false,
  lastResponseMessageId: null,
  lastResponseChatId: null,
  accumulatedText: '',
  awaitingFolderName: null,
};

export function resetProcessState(): void {
  state.runningClaude = null;
  state.isProcessing = false;
  state.lastResponseMessageId = null;
  state.lastResponseChatId = null;
  state.accumulatedText = '';
}
