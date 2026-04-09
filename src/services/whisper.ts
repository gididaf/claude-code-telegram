import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { access } from 'fs/promises';
import { config } from '../config.js';

const execAsync = promisify(exec);

export class WhisperError extends Error {
  constructor(
    public code: 'not-available' | 'ffmpeg-missing' | 'ffmpeg-failed' | 'transcription-failed' | 'empty-result',
    message: string,
  ) {
    super(message);
    this.name = 'WhisperError';
  }
}

interface WhisperCapabilities {
  hasWhisper: boolean;
  hasFfmpeg: boolean;
  whisperBinary: string;
  checked: boolean;
}

const caps: WhisperCapabilities = {
  hasWhisper: false,
  hasFfmpeg: false,
  whisperBinary: '',
  checked: false,
};

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execAsync(`which ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

async function checkCapabilities(): Promise<WhisperCapabilities> {
  if (caps.checked) return caps;

  caps.hasFfmpeg = await commandExists('ffmpeg');

  // whisper.cpp binary name varies: whisper-cli (newer), whisper (older/custom)
  if (await commandExists('whisper-cli')) {
    caps.hasWhisper = true;
    caps.whisperBinary = 'whisper-cli';
  } else if (await commandExists('whisper')) {
    caps.hasWhisper = true;
    caps.whisperBinary = 'whisper';
  }

  caps.checked = true;

  if (caps.hasWhisper) {
    console.log(`Voice: ${caps.whisperBinary} detected, ffmpeg: ${caps.hasFfmpeg}`);
  }

  return caps;
}

export async function isVoiceSupported(): Promise<boolean> {
  const c = await checkCapabilities();
  return c.hasWhisper;
}

export function resetCapabilities(): void {
  caps.checked = false;
  caps.hasWhisper = false;
  caps.hasFfmpeg = false;
  caps.whisperBinary = '';
}

async function convertOggToWav(oggPath: string): Promise<string> {
  const wavPath = oggPath.replace(/\.ogg$/, '.wav');
  try {
    await execAsync(
      `ffmpeg -i "${oggPath}" -ar 16000 -ac 1 -f wav "${wavPath}" -y`,
      { timeout: 30_000 },
    );
    return wavPath;
  } catch (err: any) {
    throw new WhisperError('ffmpeg-failed', `FFmpeg conversion failed: ${err.message}`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function resolveModelPath(): Promise<string> {
  // Explicit path takes priority
  if (config.whisperModelPath) return config.whisperModelPath;

  // Search common locations for ggml-<model>.bin
  const modelFile = `ggml-${config.whisperModel}.bin`;
  const searchPaths = [
    join(homedir(), '.local', 'share', 'whisper-models', modelFile),
    join(homedir(), '.cache', 'whisper', modelFile),
    join('/usr', 'local', 'share', 'whisper-models', modelFile),
    join('/opt', 'homebrew', 'share', 'whisper-models', modelFile),
  ];

  for (const p of searchPaths) {
    if (await fileExists(p)) return p;
  }

  throw new WhisperError(
    'not-available',
    `Whisper model "${config.whisperModel}" not found. Download it to ${searchPaths[0]} or set WHISPER_MODEL_PATH.`,
  );
}

async function transcribeAudio(audioPath: string): Promise<string> {
  const c = await checkCapabilities();

  const modelPath = await resolveModelPath();
  const modelArg = `-m "${modelPath}"`;

  const cmd = `${c.whisperBinary} ${modelArg} -f "${audioPath}" --no-timestamps -l auto`;

  try {
    const { stdout } = await execAsync(cmd, { timeout: 120_000 });
    return stdout.trim();
  } catch (err: any) {
    throw new WhisperError('transcription-failed', `Whisper transcription failed: ${err.message}`);
  }
}

export async function transcribeVoice(oggPath: string): Promise<string> {
  const c = await checkCapabilities();

  if (!c.hasWhisper) {
    throw new WhisperError(
      'not-available',
      'Voice messages require whisper.cpp. Install: https://github.com/ggerganov/whisper.cpp',
    );
  }

  if (!c.hasFfmpeg) {
    throw new WhisperError(
      'ffmpeg-missing',
      'Voice messages require ffmpeg for audio conversion. Install: brew install ffmpeg',
    );
  }

  let wavPath: string | null = null;
  try {
    wavPath = await convertOggToWav(oggPath);
    const text = await transcribeAudio(wavPath);

    if (!text) {
      throw new WhisperError('empty-result', 'Transcription produced empty text');
    }

    return text;
  } finally {
    try { if (wavPath) await unlink(wavPath); } catch { /* ignore */ }
    try { await unlink(oggPath); } catch { /* ignore */ }
  }
}
