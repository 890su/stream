// A journal message as the AI reads it (triage, naming): its text after the owner's edits, a call or a file in words,
// and who it is from. Pure over the store — no AI here.
import type { JournalStore } from '../store/store.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import { partyOf, partyOfEvent } from './parties.ts';

export function describe(event: JournalEvent, store: JournalStore): { text: string; tags: string[]; deleted: boolean } {
  let text = event.payload.text ?? '';
  let tags = event.payload.tags ?? [];
  let deleted = false;
  for (const correction of store.triage.corrections(event.id)) {
    const op = correction.payload.data?.op;
    if (op === 'edit') { text = correction.payload.text ?? text; tags = correction.payload.tags ?? tags; }
    if (op === 'delete') deleted = true;
    if (op === 'restore') deleted = false;
  }
  const data = event.payload.data ?? {};
  const call = data.call as { direction: string; duration_s?: number; name?: string; number?: string } | undefined;
  if (call) text = `[звонок ${call.direction}${call.duration_s ? `, ${call.duration_s} с` : ''}, ${call.name || call.number || 'скрытый номер'}]`;
  const media = event.payload.media ?? [];
  if (event.kind === 'voice') text = `[голосовое без расшифровки]${text ? ` ${text}` : ''}`;
  else if (media.length && !text) text = `[${event.kind === 'photo' ? 'фото' : 'файл'} без подписи]`;
  return { text, tags, deleted };
}

export function from(event: JournalEvent): string {
  // The phone companion stores every call and SMS as mine; an incoming one is from the caller.
  if (partyOfEvent(event) !== partyOf(event.author)) {
    const phone = (event.payload.data?.call ?? event.payload.data?.sms) as { name?: string; number?: string } | undefined;
    return phone?.name?.trim() || phone?.number || 'скрытый номер';
  }
  if (event.author === 'me') return 'владелец';
  const viber = event.payload.data?.viber as { chat?: string } | undefined;
  if (viber?.chat) return viber.chat;
  const telegram = event.payload.data?.telegram as { from_name?: string; chat_title?: string } | undefined;
  return telegram?.from_name || telegram?.chat_title || event.author;
}
