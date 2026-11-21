// Server entry point: reads .env, opens the journal store, starts HTTP, Telegram bots, WhatsApp and the task triage.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { JournalStore } from './store/store.ts';
import { createApp } from './server/http.ts';
import { SecretStore } from './secrets.ts';
import { ConnectorSwitches } from './switches.ts';
import { OwnerSettings } from './ownersettings.ts';
import { anthropicPlanner, anthropicNamer } from './tasks/anthropic.ts';
import { captureConfig, telegramConfig, whatsappConfig } from './config.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const port = Number(process.env.PORT || 3790);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный PORT');
const ownerToken = process.env.STREAM_OWNER_TOKEN ?? '';
if (ownerToken.length < captureConfig.min_owner_token_length) throw new Error(`Задайте STREAM_OWNER_TOKEN длиной минимум ${captureConfig.min_owner_token_length} символа`);
const dataDir = resolve(process.env.DATA_DIR || 'data');
const store = new JournalStore(dataDir);
// Optional: without it the phone companion cannot write; the owner token still opens /api/phone/*.
const phoneToken = process.env.STREAM_PHONE_TOKEN || undefined;
// Optional: the Viber bridge on the agent desktop (deploy/DESKTOP.md); without it only the owner token opens /api/viber/*.
const viberToken = process.env.STREAM_VIBER_TOKEN || undefined;
// One bot per Telegram account (CONCEPT.md §8.2): STREAM_TG_BY_BOT_TOKEN, STREAM_TG_PL_BOT_TOKEN.
const tokens = Object.fromEntries(Object.keys(telegramConfig.accounts)
  .map((account) => [account, process.env[`STREAM_TG_${account.toUpperCase()}_BOT_TOKEN`] ?? ''] as const).filter(([, value]) => value));
// TELEGRAM_API_BASE — only for local tests against a fake Bot API.
// Task triage (CONCEPT.md §2.8): without ANTHROPIC_API_KEY the triage is off and the System screen says so.
const aiKey = process.env.ANTHROPIC_API_KEY || '';
// The owner's settings from the System screen (src/ownersettings.ts): how the AI makes new tasks.
const settings = new OwnerSettings(resolve(dataDir, 'settings.json'));
const triage = { newTasks: () => settings.triageNewTasks(), planner: aiKey ? anthropicPlanner(aiKey) : null, namer: aiKey ? anthropicNamer(aiKey) : null, reason: 'нет ключа Anthropic — введите его на «Системе» (Разбор задач)',
  factory: (key: string) => ({ planner: anthropicPlanner(key), namer: anthropicNamer(key) }) };
// WhatsApp linked devices (deploy/WHATSAPP.md): STREAM_WA_<ACCOUNT>_ENABLED=1; session keys in <DATA_DIR>/whatsapp/<account>.
const whatsappAccounts = Object.keys(whatsappConfig.accounts).filter((account) => process.env[`STREAM_WA_${account.toUpperCase()}_ENABLED`] === '1');
const whatsapp = whatsappAccounts.length ? { accounts: whatsappAccounts, authRoot: resolve(dataDir, 'whatsapp') } : undefined;
// Keys entered on the System screen (src/secrets.ts): over .env, applied at once.
const secrets = new SecretStore(resolve(dataDir, 'secrets.json'));
// Connections switched off on the System screen (src/switches.ts).
const switches = new ConnectorSwitches(resolve(dataDir, 'switches.json'));
// Google Calendar (deploy/GOOGLE.md): the owner's Google client — from the System screen or .env.
const google = { publicUrl: process.env.STREAM_PUBLIC_URL || 'https://stream.sekond.pl', dir: resolve(dataDir, 'google') };
const server = createApp({ store, ownerToken, phoneToken, viberToken, telegram: { tokens, apiBase: process.env.TELEGRAM_API_BASE || undefined }, triage, whatsapp, google, secrets, switches, settings });
// Bind to loopback by default; the container sets HOST=0.0.0.0 and Docker publishes only on host loopback.
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Stream http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  server.close(() => { store.close(); process.exit(0); });
  server.closeIdleConnections();
});
