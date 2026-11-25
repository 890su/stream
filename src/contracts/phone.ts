import { HttpError } from '../server/errors.ts';
import type { JournalEvent } from './validate.ts';

// Calls and SMS from the Android companion (CONCEPT.md §8.1). The JSON Schema checks the shape of
// payload.data.call / payload.data.sms; this checks that each sits on its own kind and that the text fits.
// A reply by SMS (connector `sms`, sent by the companion) goes to a phone number only.
export const SMS_CONNECTOR = 'sms';

export function checkPhone(event: JournalEvent): void {
  const data = event.payload.data ?? {};
  const outbound = data.outbound as { connector?: string; chat_id?: string } | undefined;
  if (outbound?.connector === SMS_CONNECTOR && !/^\+?[0-9]{6,15}$/.test(outbound.chat_id ?? '')) throw new HttpError(400, 'Ответ по SMS — только на номер телефона');
  const hasText = typeof event.payload.text === 'string';
  if ('call' in data && event.kind !== 'call') throw new HttpError(400, 'payload.data.call бывает только у звонка');
  if ('sms' in data && event.kind !== 'sms') throw new HttpError(400, 'payload.data.sms бывает только у SMS');
  if (event.kind === 'call') {
    if (!('call' in data)) throw new HttpError(400, 'У звонка нет payload.data.call');
    if (hasText) throw new HttpError(400, 'У звонка нет текста: описание — отдельное сообщение');
  }
  if (event.kind === 'sms') {
    if (!('sms' in data)) throw new HttpError(400, 'У SMS нет payload.data.sms');
    if (!hasText || !event.payload.text!.trim()) throw new HttpError(400, 'У SMS нет текста');
  }
}
