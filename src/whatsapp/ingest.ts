import { nameId } from '../ids.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import type { WaItem } from './types.ts';

// A converted WhatsApp message → a journal event (source whatsapp). The id depends only on the account, the
// direction and WhatsApp's message id — not on the address form (phone or LID) — so a message delivered again,
// after a reconnect or as `append` after `notify`, is the same event. Incoming: the author is the phone (one person
// with their calls, SMS and Viber), else the name; the owner's own messages from the phone are `me`.
export function toEvent(item: WaItem, account: string): JournalEvent {
  const whatsapp = { account, chat: item.chat, jid: item.jid, ...(item.phone ? { phone: item.phone } : {}), received_at: item.date };
  return {
    id: nameId(`whatsapp|${account}|${item.out ? 'out' : 'in'}|${item.id}`), schema_version: 1, source: 'whatsapp',
    author: item.out ? 'me' : `contact:whatsapp:${item.phone ?? item.chat}`, ts: item.date, kind: item.kind,
    payload: { ...(item.text.trim() ? { text: item.text } : {}), ...(item.media?.length ? { media: item.media } : {}), data: { whatsapp } },
  };
}
