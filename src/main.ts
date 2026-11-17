import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { JournalStore } from './store/store.ts';
import { createApp } from './server/http.ts';
import { captureConfig, telegramConfig } from './config.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const port = Number(process.env.PORT || 3790);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный PORT');
const ownerToken = process.env.STREAM_OWNER_TOKEN ?? '';
if (ownerToken.length < captureConfig.min_owner_token_length) throw new Error(`Задайте STREAM_OWNER_TOKEN длиной минимум ${captureConfig.min_owner_token_length} символа`);
const store = new JournalStore(resolve(process.env.DATA_DIR || 'data'));
// Optional: without it the phone companion cannot write; the owner token still opens /api/phone/*.
const phoneToken = process.env.STREAM_PHONE_TOKEN || undefined;
// One bot per Telegram account (CONCEPT.md §8.2): STREAM_TG_BY_BOT_TOKEN, STREAM_TG_PL_BOT_TOKEN.
const tokens = Object.fromEntries(Object.keys(telegramConfig.accounts)
  .map((account) => [account, process.env[`STREAM_TG_${account.toUpperCase()}_BOT_TOKEN`] ?? ''] as const).filter(([, value]) => value));
// TELEGRAM_API_BASE — only for local tests against a fake Bot API.
// Task triage (CONCEPT.md §2.8): the AI planner is connected once the Anthropic SDK is installed.
const triage = { planner: null, reason: 'ИИ не подключён: нужен ключ ANTHROPIC_API_KEY и библиотека @anthropic-ai/sdk' };
const server = createApp({ store, ownerToken, phoneToken, telegram: { tokens, apiBase: process.env.TELEGRAM_API_BASE || undefined }, triage });
// Bind to loopback by default; the container sets HOST=0.0.0.0 and Docker publishes only on host loopback.
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Stream http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  server.close(() => { store.close(); process.exit(0); });
  server.closeIdleConnections();
});
