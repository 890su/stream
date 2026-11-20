import { HttpError } from '../server/errors.ts';
import type { JournalEvent } from './validate.ts';

// Viber messages and replies (deploy/DESKTOP.md, decision 2026-11-20). The JSON Schema checks the shape of
// payload.data.viber; this checks where it may appear and that a reply to Viber goes to a phone number —
// never to a name, which may be shared by several chats («Неизвестно»).

export const VIBER_CONNECTOR = 'viber';

export function checkViber(event: JournalEvent): void {
  const data = event.payload.data ?? {};
  if ('viber' in data) {
    if (event.source !== 'viber') throw new HttpError(400, 'payload.data.viber бывает только у source: viber');
    if (!['text', 'photo', 'file'].includes(event.kind)) throw new HttpError(400, 'Сообщение Viber — это text, photo или file');
    if (!(data.viber as { chat?: string }).chat?.trim()) throw new HttpError(400, 'У сообщения Viber нет чата');
  } else if (event.source === 'viber' && event.kind !== 'correction') {
    throw new HttpError(400, 'У сообщения Viber нет payload.data.viber');
  }
  const outbound = data.outbound as { connector?: string; chat_id?: string } | undefined;
  if (outbound?.connector === VIBER_CONNECTOR && !/^\+[0-9]{6,15}$/.test(outbound.chat_id ?? '')) {
    throw new HttpError(400, 'Ответ в Viber — только по номеру телефона');
  }
}
