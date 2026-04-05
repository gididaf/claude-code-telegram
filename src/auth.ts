import type { Context, NextFunction } from 'grammy';
import { config } from './config.js';

export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  if (userId !== config.telegramUserId) {
    if (ctx.message) {
      await ctx.reply('Unauthorized. This bot is private.');
    }
    return;
  }

  await next();
}
