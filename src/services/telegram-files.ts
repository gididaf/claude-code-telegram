import { writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import type { Api } from 'grammy';
import { config } from '../config.js';

const TEMP_DIR = '/tmp/claude-telegram';

let tempDirReady = false;

async function ensureTempDir(): Promise<void> {
  if (tempDirReady) return;
  await mkdir(TEMP_DIR, { recursive: true });
  tempDirReady = true;
}

export async function downloadTelegramFile(
  api: Api,
  fileId: string,
  suggestedName?: string,
): Promise<string> {
  await ensureTempDir();

  const file = await api.getFile(fileId);
  if (!file.file_path) {
    throw new Error('No file path returned from Telegram');
  }

  const ext = extname(file.file_path) || '.bin';
  const filename = suggestedName || `${file.file_unique_id}${ext}`;

  const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const localPath = join(TEMP_DIR, filename);
  await writeFile(localPath, buffer);

  return localPath;
}
