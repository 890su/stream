import { HttpError } from '../server/errors.ts';
import { whatsappConfig } from '../config.ts';
import type { JournalEvent } from './validate.ts';

// WhatsApp messages and replies (docs/plans/2026-11-20-whatsapp-baileys-design.md). The JSON Schema checks the shape
// of payload.data.whatsapp; this checks where it may appear, that its account is known, and that a reply to WhatsApp
// goes to a phone number — never to a name or an anonymous (LID) address.

export const WHATSAPP_SOURCE = 'whatsapp';
const MESSAGE_KINDS = ['text', 'voice', 'photo', 'file'];

export function whatsappAccountOf(connector: string): string | undefined {
  return Object.entries(whatsappConfig.accounts).find(([, account]) => account.connector === connector)?.[0];
}

export function checkWhatsapp(event: JournalEvent): void {
  const data = event.payload.data ?? {};
  if ('whatsapp' in data) {
    if (event.source !== WHATSAPP_SOURCE) throw new HttpError(400, 'payload.data.whatsapp бывает только у source: whatsapp');
    if (!MESSAGE_KINDS.includes(event.kind)) throw new HttpError(400, 'Сообщение WhatsApp — это text, voice, photo или file');
    const account = (data.whatsapp as { account?: string }).account ?? '';
    if (!Object.hasOwn(whatsappConfig.accounts, account)) throw new HttpError(400, 'Неизвестный аккаунт WhatsApp');
  } else if (event.source === WHATSAPP_SOURCE && event.kind !== 'correction') {
    throw new HttpError(400, 'У сообщения WhatsApp нет payload.data.whatsapp');
  }
  const outbound = data.outbound as { connector?: string; chat_id?: string } | undefined;
  if (outbound?.connector && whatsappAccountOf(outbound.connector) && !/^\+[0-9]{6,15}$/.test(outbound.chat_id ?? '')) {
    throw new HttpError(400, 'Ответ в WhatsApp — только по номеру телефона');
  }
}
