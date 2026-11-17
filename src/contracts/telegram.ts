import { HttpError } from '../server/errors.ts';
import { telegramConfig } from '../config.ts';
import type { JournalEvent } from './validate.ts';

// Telegram messages and replies (CONCEPT.md §8.2). The JSON Schema checks the shapes of
// payload.data.telegram / outbound / action / system; this checks where each may appear.

const MESSAGE_KINDS = ['text', 'voice', 'photo', 'file'];

export function connectorAccount(connector: string): string | undefined {
  return Object.entries(telegramConfig.accounts).find(([, account]) => account.connector === connector)?.[0];
}

export function checkTelegram(event: JournalEvent): void {
  const data = event.payload.data ?? {};
  if ('telegram' in data) {
    if (event.source !== 'telegram') throw new HttpError(400, 'payload.data.telegram бывает только у source: telegram');
    if (!MESSAGE_KINDS.includes(event.kind)) throw new HttpError(400, 'Сообщение Telegram — это text, voice, photo или file');
    const account = (data.telegram as { account: string }).account;
    if (!Object.hasOwn(telegramConfig.accounts, account)) throw new HttpError(400, 'Неизвестный аккаунт Telegram');
  } else if (event.source === 'telegram' && event.kind !== 'correction') {
    throw new HttpError(400, 'У сообщения Telegram нет payload.data.telegram');
  }
  if ('outbound' in data) {
    if (event.kind !== 'text' || event.author !== 'me') throw new HttpError(400, 'Ответ наружу — только текст владельца');
    if (!event.payload.text?.trim()) throw new HttpError(400, 'Пустой ответ');
    if (!connectorAccount((data.outbound as { connector: string }).connector)) throw new HttpError(400, 'Неизвестный коннектор ответа');
  }
  if ('action' in data && event.kind !== 'action_result') throw new HttpError(400, 'payload.data.action бывает только у action_result');
  if ('system' in data && event.kind !== 'system') throw new HttpError(400, 'payload.data.system бывает только у system');
}
