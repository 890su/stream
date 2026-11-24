// Streams of messages for the triage: which stream a message belongs to (a chat, a number on a messenger, the phone,
// my notes) and how long its quiet window is before its messages go to the AI. Pure.
import type { JournalEvent } from '../contracts/validate.ts';
import { tasksConfig } from '../config.ts';

// Which stream a message belongs to: messages of one stream share a quiet window.
export function streamOf(event: JournalEvent): string {
  const data = event.payload.data ?? {};
  const telegram = data.telegram as { account: string; chat_id: string } | undefined;
  if (telegram) return `tg|${telegram.account}|${telegram.chat_id}`;
  const outbound = data.outbound as { connector: string; chat_id: string } | undefined;
  const viber = data.viber as { chat: string; phone?: string } | undefined;
  if (viber) return `viber|${viber.phone ?? viber.chat}`;
  if (outbound?.connector === 'viber') return `viber|${outbound.chat_id}`;
  const whatsapp = data.whatsapp as { jid: string; phone?: string } | undefined;
  if (whatsapp) return `whatsapp|${whatsapp.phone ?? whatsapp.jid}`;
  if (outbound?.connector.startsWith('whatsapp_')) return `whatsapp|${outbound.chat_id}`;
  if (outbound) return `tg|${outbound.connector.replace(/^telegram_/, '')}|${outbound.chat_id}`;
  if (event.source === 'android_phone') return 'phone';
  return 'me';
}

// Quiet window of a stream in seconds: by its kind (`tg`, `phone`, `me`), else the default.
export function quietOf(stream: string): number {
  return tasksConfig.quiet_s_by_stream[stream.split('|')[0]!] ?? tasksConfig.quiet_s;
}
