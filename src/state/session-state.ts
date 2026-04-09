import type { ClaudeProcess } from '../services/claude.js';
import { config } from '../config.js';

export interface QuestionData {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

export interface PendingQuestion {
  questions: QuestionData[];
  currentIndex: number;
  answers: Record<string, string>;
  selectedOptions: Set<number>;
  messageId: number | null;
  chatId: number | null;
}

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
  queuedMessage: string | null;
  queuedMessageId: number | null;
  queuedChatId: number | null;
  pendingQuestion: PendingQuestion | null;
  currentPlanPath: string | null;
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
  queuedMessage: null,
  queuedMessageId: null,
  queuedChatId: null,
  pendingQuestion: null,
  currentPlanPath: null,
};

export function resetProcessState(): void {
  state.runningClaude = null;
  state.isProcessing = false;
  state.lastResponseMessageId = null;
  state.lastResponseChatId = null;
  state.accumulatedText = '';
}
