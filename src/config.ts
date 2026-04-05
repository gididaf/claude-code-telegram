import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { homedir } from 'os';
import type { BotConfig } from './types.js';

loadEnv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const home = process.env.HOME_DIR || homedir();

export const config: BotConfig = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  telegramUserId: parseInt(requireEnv('TELEGRAM_USER_ID'), 10),
  claudeCliPath: process.env.CLAUDE_CLI_PATH || 'claude',
  defaultProjectPath: process.env.DEFAULT_PROJECT_PATH || null,
  streamUpdateIntervalMs: parseInt(process.env.STREAM_UPDATE_INTERVAL_MS || '2500', 10),
  processTimeoutMs: parseInt(process.env.PROCESS_TIMEOUT_MS || '300000', 10),
  homeDir: home,
  claudeProjectsDir: resolve(home, '.claude', 'projects'),
};

if (isNaN(config.telegramUserId)) {
  console.error('TELEGRAM_USER_ID must be a number');
  process.exit(1);
}
