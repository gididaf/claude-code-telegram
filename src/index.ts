import { createBot } from './bot.js';
import { config } from './config.js';

async function main() {
  console.log('Starting Claude Code Telegram bot...');
  console.log(`Authorized user ID: ${config.telegramUserId}`);

  const bot = createBot();

  await bot.api.setMyCommands([
    { command: 'start', description: 'Show welcome message' },
    { command: 'projects', description: 'Browse projects' },
    { command: 'session', description: 'Switch or start sessions' },
    { command: 'new', description: 'Start a new project' },
    { command: 'cancel', description: 'Cancel running request' },
    { command: 'status', description: 'Show current state' },
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
