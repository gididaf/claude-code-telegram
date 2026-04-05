import { readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';

const HIDDEN_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__',
  '.cache', '.npm', '.yarn', '.pnpm', 'dist', 'build',
  '.next', '.nuxt', '.output', 'coverage', '.turbo',
]);

export interface DirEntry {
  name: string;
  fullPath: string;
}

export async function listDirectories(path: string): Promise<DirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true });

  const dirs: DirEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip hidden dirs (starting with .) unless they're important
    if (entry.name.startsWith('.') && !entry.name.startsWith('.config')) continue;
    if (HIDDEN_DIRS.has(entry.name)) continue;

    dirs.push({
      name: entry.name,
      fullPath: join(path, entry.name),
    });
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  return dirs;
}

export function getParentDir(path: string): string | null {
  const parent = dirname(path);
  if (parent === path) return null; // at root
  return parent;
}

// In-memory cache for callback data (Telegram has 64-byte limit)
const pathCache = new Map<number, string>();
let pathCounter = 0;

export function encodePath(fullPath: string): string {
  const id = pathCounter++;
  pathCache.set(id, fullPath);
  return `d:${id}`;
}

export function encodeSelect(fullPath: string): string {
  const id = pathCounter++;
  pathCache.set(id, fullPath);
  return `ds:${id}`;
}

export function decodePath(callbackData: string): string | undefined {
  const id = parseInt(callbackData.split(':')[1], 10);
  return pathCache.get(id);
}
