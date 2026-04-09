import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { config } from './config.js';
import { authMiddleware } from './auth.js';
import { handleStart } from './handlers/start.js';
import { handleProjects } from './handlers/projects.js';
import { handleNewCommand } from './handlers/newproject.js';
import { handleSession, handleStatus } from './handlers/status.js';
import { handleHistoryCommand } from './handlers/sessions.js';
import { handleCallback } from './handlers/callbacks.js';
import { handleChat } from './handlers/chat.js';
import { handleBash } from './handlers/bash.js';
import { handlePlan } from './handlers/plan.js';

export function createBot(): Bot {
  const bot = new Bot(config.telegramBotToken);

  bot.api.config.use(autoRetry());

  bot.use(authMiddleware);

  // Commands
  bot.command('start', handleStart);
  bot.command('projects', (ctx) => handleProjects(ctx, 0));
  bot.command('new', handleNewCommand);
  bot.command('resume', handleSession);
  bot.command('rewind', handleHistoryCommand);
  bot.command('status', handleStatus);
  bot.command('bash', handleBash);
  bot.command('plan', handlePlan);

  // Callback queries (inline keyboard)
  bot.on('callback_query:data', handleCallback);

  // Text messages go to Claude (must be last)
  bot.on('message:text', handleChat);

  bot.catch((err) => {
    console.error('Bot error:', err.message);
  });

  return bot;
}
