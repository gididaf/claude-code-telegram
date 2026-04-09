import { access, readdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';
import type { ConversationMessage, ProjectInfo, SessionInfo, SessionsIndex } from '../types.js';

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

  // Count actual .jsonl files on disk
  let jsonlFiles: string[];
  try {
    const entries = await readdir(projectDir);
    jsonlFiles = entries.filter(e => e.endsWith('.jsonl'));
  } catch {
    return null;
  }

  if (jsonlFiles.length === 0) return null;

  // Use index for originalPath if available
  const index = await readSessionsIndex(dirName);
  const originalPath = index?.originalPath || dirNameToPath(dirName);
  const dirStat = await stat(projectDir);

  return {
    dirName,
    originalPath,
    displayName: pathToDisplayName(originalPath),
    sessionCount: jsonlFiles.length,
    lastModified: dirStat.mtime,
  };
}

export async function listSessions(dirName: string): Promise<SessionInfo[]> {
  const projectDir = join(config.claudeProjectsDir, dirName);

  // Get actual .jsonl files on disk
  let jsonlFiles: Set<string>;
  try {
    const entries = await readdir(projectDir);
    jsonlFiles = new Set(entries.filter(e => e.endsWith('.jsonl')).map(e => e.replace('.jsonl', '')));
  } catch {
    return [];
  }

  const sessions: SessionInfo[] = [];
  const coveredIds = new Set<string>();

  // Use index for rich metadata, but only for sessions that exist on disk
  const index = await readSessionsIndex(dirName);
  if (index && index.entries.length > 0) {
    for (const e of index.entries) {
      if (e.isSidechain || !jsonlFiles.has(e.sessionId)) continue;
      coveredIds.add(e.sessionId);
      sessions.push({
        sessionId: e.sessionId,
        summary: e.summary || '(no summary)',
        messageCount: e.messageCount,
        created: new Date(e.created),
        modified: new Date(e.modified),
        gitBranch: e.gitBranch || '',
        projectPath: e.projectPath || '',
        firstPrompt: e.firstPrompt || '',
        isSidechain: e.isSidechain,
      });
    }
  }

  // Parse any .jsonl files not covered by the index
  for (const sessionId of jsonlFiles) {
    if (coveredIds.has(sessionId)) continue;
    const filePath = join(projectDir, `${sessionId}.jsonl`);
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
        // Count only visible messages (same filter as getSessionHistory)
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter((b: any) => b.type === 'text' && b.text)
            .map((b: any) => b.text)
            .join('\n');
        }
        if (text && !(text.startsWith('<') && !text.includes('\n') && text.endsWith('>'))) {
          messageCount++;
        }
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

export async function getSessionHistory(dirName: string, sessionId: string): Promise<ConversationMessage[]> {
  const filePath = join(config.claudeProjectsDir, dirName, `${sessionId}.jsonl`);
  const raw = await readFile(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  const messages: ConversationMessage[] = [];

  for (const line of lines) {
    try {
      const d = JSON.parse(line);
      const msg = d.message;
      if (!msg?.role || (msg.role !== 'user' && msg.role !== 'assistant')) continue;

      let text = '';
      const toolNames: string[] = [];

      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          } else if (block.type === 'tool_use' && block.name) {
            toolNames.push(block.name);
          }
        }
        text = textParts.join('\n');
      }

      // Skip system/XML-only messages and empty messages
      if (!text || (text.startsWith('<') && !text.includes('\n') && text.endsWith('>'))) continue;

      // For assistant messages, append brief tool summary
      if (msg.role === 'assistant' && toolNames.length > 0) {
        text += `\n[Tools: ${toolNames.join(', ')}]`;
      }

      messages.push({
        role: msg.role,
        text,
        timestamp: d.timestamp || '',
      });
    } catch {
      // Skip malformed lines
    }
  }

  return messages;
}

/**
 * Rewind a session to a specific visible message index.
 * Truncates the .jsonl file in-place, removing all lines after that message.
 */
export async function rewindSessionTo(dirName: string, sessionId: string, messageIndex: number): Promise<void> {
  const filePath = join(config.claudeProjectsDir, dirName, `${sessionId}.jsonl`);
  const raw = await readFile(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  // Walk raw lines with same filter logic as getSessionHistory to count visible messages
  let visibleCount = 0;
  let cutAfterLine = lines.length - 1; // default: keep everything

  for (let i = 0; i < lines.length; i++) {
    try {
      const d = JSON.parse(lines[i]);
      const msg = d.message;
      if (!msg?.role || (msg.role !== 'user' && msg.role !== 'assistant')) continue;

      let text = '';
      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content.filter((b: any) => b.type === 'text' && b.text).map((b: any) => b.text).join('\n');
      }

      if (!text || (text.startsWith('<') && !text.includes('\n') && text.endsWith('>'))) continue;

      // This is a visible message
      if (visibleCount === messageIndex) {
        cutAfterLine = i;
        break;
      }
      visibleCount++;
    } catch {
      continue;
    }
  }

  // Truncate file in-place — keep all raw lines up to and including cutAfterLine
  const keptLines = lines.slice(0, cutAfterLine + 1);
  await writeFile(filePath, keptLines.join('\n') + '\n');
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
