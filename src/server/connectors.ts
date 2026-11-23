import { join } from 'node:path';
import type { JournalStore } from '../store/store.ts';
import type { LiveFeed } from './live.ts';
import { telegramConfig, whatsappConfig } from '../config.ts';
import { TelegramBot } from '../telegram/bot.ts';
import { WhatsAppClient } from '../whatsapp/client.ts';
import type { SocketFactory } from '../whatsapp/types.ts';
import { Triage } from '../tasks/triage.ts';
import type { Planner } from '../tasks/planner.ts';
import type { Namer } from '../tasks/namer.ts';
import { createGoogle, type GoogleOptions } from './google.ts';
import type { SecretStore } from '../secrets.ts';
import type { ConnectorSwitches } from '../switches.ts';
import type { TriageNewTasks } from '../ownersettings.ts';
import { sourceTitle } from './system.ts';
import { nameId } from '../ids.ts';

// The connections running inside the server (System screen, owner 2026-11-21): Telegram bots, WhatsApp clients, the
// task triage, Google Calendar. Each runs while it has what it needs (a token, a key) and is switched on; a key entered
// or a switch flipped on the System screen applies at once — a bot or a client restarts or stops, the triage pauses,
// Google stops reading. Switching is written to the feed.

export type TriageOptions = { planner: Planner | null; namer?: Namer | null; reason?: string; everyMs?: number; factory?: (key: string) => { planner: Planner; namer: Namer };
  newTasks?: () => TriageNewTasks }; // how the AI makes new tasks (src/ownersettings.ts)

export function createConnections({ store, live, ownerToken, telegram, whatsapp, triage, google, secrets, switches }: {
  store: JournalStore; live: LiveFeed; ownerToken: string;
  telegram?: { tokens: Record<string, string>; apiBase?: string };
  whatsapp?: { accounts: string[]; authRoot: string; factory?: SocketFactory; retryMs?: number };
  triage?: TriageOptions; google?: GoogleOptions; secrets?: SecretStore; switches?: ConnectorSwitches;
}) {
  const isOn = (id: string) => switches?.isOn(id) ?? true;
  let listening = false;

  // Telegram: one bot per account with a token (the System screen's key, else .env), while switched on.
  const tokenOf = (account: string) => secrets?.get(`STREAM_TG_${account.toUpperCase()}_BOT_TOKEN` as never) ?? telegram?.tokens[account] ?? '';
  const bots: TelegramBot[] = [];
  function syncBot(account: string): void {
    const index = bots.findIndex((bot) => bot.account === account);
    if (index >= 0) { bots[index]!.stop(); bots.splice(index, 1); }
    const token = tokenOf(account);
    if (!token || !isOn(telegramConfig.accounts[account]!.connector)) return;
    const bot = new TelegramBot({ account, token, store, live, apiBase: telegram?.apiBase });
    bots.push(bot);
    if (listening) void bot.start();
  }
  for (const account of Object.keys(telegramConfig.accounts)) syncBot(account);

  // WhatsApp: the accounts enabled at the server (deploy/WHATSAPP.md), running while switched on.
  const socketFactory: SocketFactory = whatsapp?.factory ?? (async (dir) => (await import('../whatsapp/socket.ts')).createSocket(dir));
  const whatsappClients = (whatsapp?.accounts ?? []).filter((account) => whatsappConfig.accounts[account])
    .map((account) => new WhatsAppClient({ account, store, live, authDir: join(whatsapp!.authRoot, account), factory: socketFactory, retryMs: whatsapp?.retryMs }));
  const running = new Set<WhatsAppClient>();
  function syncWhatsApp(client: WhatsAppClient): void {
    const on = listening && isOn(client.connector);
    if (on && !running.has(client)) { running.add(client); client.start().catch((error) => console.error(`WhatsApp ${client.account}: start failed`, error instanceof Error ? error.message : error)); }
    if (!on && running.has(client)) { running.delete(client); client.stop(); }
  }

  // The triage: its AI key from the System screen or .env; paused while switched off.
  const aiKey = () => secrets?.get('ANTHROPIC_API_KEY');
  const made = aiKey() && triage?.factory ? triage.factory(aiKey()!) : null;
  const triageWorker = triage ? new Triage({ store, live, planner: made?.planner ?? triage.planner, namer: made?.namer ?? triage.namer ?? null, reason: triage.reason, ...(triage.newTasks ? { newTasks: triage.newTasks } : {}) }) : null;
  let triaging = false;
  function syncTriage(): void {
    if (!triageWorker) return;
    const on = listening && isOn('ai_triage');
    if (on && !triaging) { triaging = true; triageWorker.start(triage?.everyMs); }
    if (!on && triaging) { triaging = false; triageWorker.stop(); }
  }

  const googleConnector = google?.dir ? createGoogle({ store, live, ownerToken, options: { ...google,
    credentials: secrets ? () => ({ clientId: secrets.get('STREAM_GOOGLE_CLIENT_ID') ?? google.clientId, clientSecret: secrets.get('STREAM_GOOGLE_CLIENT_SECRET') ?? google.clientSecret }) : google.credentials,
    enabled: () => isOn('google_calendar') } }) : null;

  secrets?.onChange((name) => {
    if (name.startsWith('STREAM_GOOGLE_')) { googleConnector?.reconfigure(); return; }
    if (name === 'ANTHROPIC_API_KEY') {
      const key = aiKey();
      const next = key && triage?.factory ? triage.factory(key) : { planner: triage?.planner ?? null, namer: triage?.namer ?? null };
      triageWorker?.use(next.planner, next.namer ?? null);
      console.log('Triage: AI key changed on the System screen');
      return;
    }
    const account = /^STREAM_TG_([A-Z]+)_BOT_TOKEN$/.exec(name)?.[1]?.toLowerCase();
    if (account && telegramConfig.accounts[account]) { syncBot(account); console.log(`Telegram ${account}: token changed on the System screen`); }
  });

  switches?.onChange((id, on) => {
    const at = new Date().toISOString();
    const result = store.appendEvent({
      id: nameId(`switch|${id}|${at}`), schema_version: 1, source: 'system', author: 'system', ts: at, kind: 'system',
      payload: { text: `${sourceTitle(id)}: ${on ? 'включён' : 'выключен'} на «Системе»`, data: { system: { source: id, state: on ? 'ok' : 'off', previous: on ? 'off' : 'ok' } } },
    });
    if (result.created) live.publish(result.event);
    console.log(`Switch: ${id} ${on ? 'on' : 'off'}`);
    const account = Object.entries(telegramConfig.accounts).find(([, item]) => item.connector === id)?.[0];
    if (account) syncBot(account);
    for (const client of whatsappClients) if (client.connector === id) syncWhatsApp(client);
    if (id === 'ai_triage') syncTriage();
    if (id === 'google_calendar') googleConnector?.reconfigure();
  });

  return {
    bots, whatsappClients, google: googleConnector, isOn,
    triage: triageWorker, // «✨ Разобрать заново» (src/tasks/retriage.ts) runs it at once
    start(): void {
      listening = true;
      for (const bot of bots) void bot.start();
      for (const client of whatsappClients) syncWhatsApp(client);
      syncTriage();
      googleConnector?.start();
    },
    stop(): void {
      listening = false;
      for (const bot of bots) bot.stop();
      for (const client of whatsappClients) if (running.has(client)) { running.delete(client); client.stop(); }
      if (triaging) { triaging = false; triageWorker?.stop(); }
      googleConnector?.stop();
    },
  };
}
