export interface BotConfig {
  telegramBotToken: string;
  telegramUserId: number;
  claudeCliPath: string;
  defaultProjectPath: string | null;
  streamUpdateIntervalMs: number;
  processTimeoutMs: number;
  homeDir: string;
  claudeProjectsDir: string;
}

export interface ProjectInfo {
  dirName: string;
  originalPath: string;
  displayName: string;
  sessionCount: number;
  lastModified: Date;
}

export interface SessionInfo {
  sessionId: string;
  summary: string;
  messageCount: number;
  created: Date;
  modified: Date;
  gitBranch: string;
  projectPath: string;
  firstPrompt: string;
  isSidechain: boolean;
}

export interface SessionsIndex {
  version: number;
  entries: SessionsIndexEntry[];
  originalPath: string;
}

export interface SessionsIndexEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}
