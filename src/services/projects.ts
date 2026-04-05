import { access, readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';
import type { ProjectInfo, SessionInfo, SessionsIndex } from '../types.js';

const IGNORED_PREFIXES = ['-private-var', '-private-tmp'];

export async function listProjects(): Promise<ProjectInfo[]> {
  const projectsDir = config.claudeProjectsDir;
  let dirs: string[];

  try {
    dirs = await readdir(projectsDir);
  } catch {
    return [];
  }

  const projects: ProjectInfo[] = [];

  for (const dirName of dirs) {
    if (dirName === '-' || IGNORED_PREFIXES.some(p => dirName.startsWith(p))) {
      continue;
    }

    try {
      const project = await buildProjectInfo(dirName);
      if (!project) continue;
      // Only show projects whose directory still exists on disk
      try { await access(project.originalPath); } catch { continue; }
      projects.push(project);
    } catch {
      // Skip unreadable projects
    }
  }

  projects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  return projects;
}

async function buildProjectInfo(dirName: string): Promise<ProjectInfo | null> {
  const projectDir = join(config.claudeProjectsDir, dirName);

  // Try sessions-index.json first (has rich metadata)
  const index = await readSessionsIndex(dirName);
  if (index && index.entries.length > 0) {
    const realEntries = index.entries.filter(e => !e.isSidechain);
    if (realEntries.length > 0) {
      const latestEntry = realEntries.reduce((a, b) =>
        new Date(b.modified) > new Date(a.modified) ? b : a
      );

      const originalPath = index.originalPath || latestEntry.projectPath || dirNameToPath(dirName);
      return {
        dirName,
        originalPath,
        displayName: pathToDisplayName(originalPath),
        sessionCount: realEntries.length,
        lastModified: new Date(latestEntry.modified),
      };
    }
  }

  // Fallback: count .jsonl session files (UUID dirs are subagent containers, not sessions)
  const entries = await readdir(projectDir);
  const jsonlFiles = entries.filter(e => e.endsWith('.jsonl'));

  if (jsonlFiles.length === 0) return null;

  // Get last modified time from directory
  const dirStat = await stat(projectDir);
  const originalPath = dirNameToPath(dirName);

  return {
    dirName,
    originalPath,
    displayName: pathToDisplayName(originalPath),
    sessionCount: jsonlFiles.length,
    lastModified: dirStat.mtime,
  };
}

export async function listSessions(dirName: string): Promise<SessionInfo[]> {
  // Try index first
  const index = await readSessionsIndex(dirName);
  if (index && index.entries.length > 0) {
    const sessions = index.entries
      .filter(e => !e.isSidechain)
      .map(e => ({
        sessionId: e.sessionId,
        summary: e.summary || '(no summary)',
        messageCount: e.messageCount,
        created: new Date(e.created),
        modified: new Date(e.modified),
        gitBranch: e.gitBranch || '',
        projectPath: e.projectPath || '',
        firstPrompt: e.firstPrompt || '',
        isSidechain: e.isSidechain,
      }));

    sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
    return sessions;
  }

  // Fallback: parse .jsonl files directly
  const projectDir = join(config.claudeProjectsDir, dirName);
  const entries = await readdir(projectDir);
  const jsonlFiles = entries.filter(e => e.endsWith('.jsonl'));

  const sessions: SessionInfo[] = [];
  for (const file of jsonlFiles) {
    const sessionId = file.replace('.jsonl', '');
    const filePath = join(projectDir, file);

    try {
      const meta = await parseSessionJsonl(filePath);
      sessions.push({
        sessionId,
        summary: meta.firstPrompt || '(no summary)',
        messageCount: meta.messageCount,
        created: meta.created,
        modified: meta.modified,
        gitBranch: '',
        projectPath: dirNameToPath(dirName),
        firstPrompt: meta.firstPrompt,
        isSidechain: false,
      });
    } catch {
      // Skip unreadable files
    }
  }

  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}

async function readSessionsIndex(dirName: string): Promise<SessionsIndex | null> {
  const indexPath = join(config.claudeProjectsDir, dirName, 'sessions-index.json');
  try {
    const raw = await readFile(indexPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface SessionMeta {
  firstPrompt: string;
  messageCount: number;
  created: Date;
  modified: Date;
}

async function parseSessionJsonl(filePath: string): Promise<SessionMeta> {
  const raw = await readFile(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  let messageCount = 0;
  let firstPrompt = '';
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  for (const line of lines) {
    try {
      const d = JSON.parse(line);
      const msg = d.message;
      if (!msg?.role) continue;

      if (msg.role === 'user' || msg.role === 'assistant') {
        messageCount++;
      }

      if (d.timestamp) {
        if (!firstTimestamp) firstTimestamp = d.timestamp;
        lastTimestamp = d.timestamp;
      }

      // Extract first real user prompt
      if (msg.role === 'user' && !firstPrompt) {
        const content = msg.content;
        if (typeof content === 'string' && !content.startsWith('<')) {
          firstPrompt = content.substring(0, 100);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && !block.text.startsWith('<')) {
              firstPrompt = block.text.substring(0, 100);
              break;
            }
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  const fileStat = await stat(filePath);
  return {
    firstPrompt,
    messageCount,
    created: firstTimestamp ? new Date(firstTimestamp) : fileStat.birthtime,
    modified: lastTimestamp ? new Date(lastTimestamp) : fileStat.mtime,
  };
}

function dirNameToPath(dirName: string): string {
  if (dirName.startsWith('-')) {
    return '/' + dirName.substring(1).replace(/-/g, '/');
  }
  return dirName;
}

function pathToDisplayName(fullPath: string): string {
  const home = config.homeDir;
  if (fullPath.startsWith(home)) {
    return '~' + fullPath.substring(home.length);
  }
  return fullPath;
}
