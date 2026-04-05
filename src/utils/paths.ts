import { resolve } from 'path';
import { config } from '../config.js';

export function getClaudeProjectsDir(): string {
  return config.claudeProjectsDir;
}

export function resolveHome(filepath: string): string {
  if (filepath.startsWith('~')) {
    return resolve(config.homeDir, filepath.slice(2));
  }
  return filepath;
}
