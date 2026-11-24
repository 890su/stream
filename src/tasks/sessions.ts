// Conversations and sessions for the triage (CONCEPT.md §2.8, triage-ai-v19). A conversation is the queue's one
// (web/conversations.js): a Telegram chat, one phone number with its calls, SMS, Viber and WhatsApp, my notes.
// A session is its run of messages without a pause longer than the gap; the AI sees the last one before the new
// messages and may ask for the one before it. Pure — no store, no AI.
import type { JournalEvent } from '../contracts/validate.ts';
import { phoneNumber } from './parties.ts';
import { streamOf } from './streams.ts';

export function conversationOf(event: JournalEvent): string {
  const data = (event.payload.data ?? {}) as Record<string, any>;
  if (data.viber) return data.viber.phone ? `tel:${data.viber.phone}` : `viber:${data.viber.chat}`;
  if (data.outbound?.connector === 'viber') return `tel:${data.outbound.chat_id}`;
  if (data.whatsapp) return data.whatsapp.phone ? `tel:${data.whatsapp.phone}` : `wa:${data.whatsapp.jid}`;
  if (data.outbound?.connector?.startsWith('whatsapp_')) return `tel:${data.outbound.chat_id}`;
  const chat = data.telegram?.chat_id ?? data.outbound?.chat_id;
  if (chat !== undefined && chat !== null) return `tg:${chat}`;
  if (event.kind === 'call' || event.kind === 'sms') {
    const number = phoneNumber(event.kind === 'call' ? data.call?.number : data.sms?.number);
    return number && number !== '+' ? `tel:${number}` : 'phone'; // a hidden number keeps the old phone stream
  }
  return streamOf(event);
}

// Message order: when it was written, then when it came in (equal times keep their arrival order).
const order = (event: JournalEvent) => `${event.ts}|${event.received_at ?? ''}`;
export const before = (a: JournalEvent, b: JournalEvent): boolean => order(a) < order(b);

export function sessionsOf(events: JournalEvent[], gapMs: number): JournalEvent[][] {
  const sorted = [...events].sort((a, b) => order(a).localeCompare(order(b)));
  const sessions: JournalEvent[][] = [];
  for (const event of sorted) {
    const last = sessions.at(-1)?.at(-1);
    if (last && Date.parse(event.ts) - Date.parse(last.ts) <= gapMs) sessions.at(-1)!.push(event);
    else sessions.push([event]);
  }
  return sessions;
}

// The last session of `history` and `steps` sessions before it, each cut to its newest `limit` messages;
// `more` — an earlier session exists for one more step back.
export function contextSessions(history: JournalEvent[], { gapMs, steps, limit }: { gapMs: number; steps: number; limit: number }): { events: JournalEvent[]; more: boolean } {
  const sessions = sessionsOf(history, gapMs);
  const taken = sessions.slice(-(steps + 1));
  return { events: taken.flatMap((session) => session.slice(-limit)), more: sessions.length > taken.length };
}
