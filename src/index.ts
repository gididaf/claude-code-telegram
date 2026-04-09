import { createBot } from './bot.js';
import { config } from './config.js';

async function main() {
  console.log('Starting Claude Code Telegram bot...');
  console.log(`Authorized user ID: ${config.telegramUserId}`);

  const bot = createBot();

  await bot.api.setMyCommands([
    { command: 'start', description: 'Show welcome message' },
    { command: 'projects', description: 'Browse projects' },
    { command: 'resume', description: 'Switch or resume sessions' },
    { command: 'new', description: 'Start new session' },
    { command: 'rewind', description: 'Rewind session to a previous point' },
    { command: 'status', description: 'Show current state' },
    { command: 'bash', description: 'Run a shell command directly' },
    { command: 'plan', description: 'View current plan' },
    { command: 'compact', description: 'Compact conversation to free context' },
    { command: 'diff', description: 'Show git changes' },
  ]);

  bot.start({
    onStart: () => {
      console.log('Bot is running. Listening for messages...');
    },
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
