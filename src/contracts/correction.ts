import { HttpError } from '../server/errors.ts';
import type { JournalEvent } from './validate.ts';

// Owner actions on a message are new journal events (CONCEPT.md §2.4); the original never changes.
export const CORRECTION_OPS = ['edit', 'archive', 'unarchive', 'delete', 'restore'] as const;

// Shape rules that need no database. `target` is checked separately, inside the write transaction.
export function checkCorrectionShape(event: JournalEvent): void {
  if (event.kind !== 'correction') return;
  const ref = event.payload.ref;
  if (!ref) throw new HttpError(400, 'Правка должна ссылаться на сообщение (payload.ref)');
  if (ref.type !== 'event') throw new HttpError(400, 'Правка относится только к сообщению');
  const op = event.payload.data?.op;
  if (typeof op !== 'string' || !(CORRECTION_OPS as readonly string[]).includes(op)) {
    throw new HttpError(400, `Неизвестное действие правки. Допустимо: ${CORRECTION_OPS.join(', ')}`);
  }
  if (op === 'edit' && typeof event.payload.text !== 'string') throw new HttpError(400, 'Правка текста должна содержать text');
}

export function checkCorrectionTarget(event: JournalEvent, target: JournalEvent | undefined): void {
  if (event.kind !== 'correction') return;
  if (!target) throw new HttpError(422, 'Исходное сообщение ещё не принято. Правка будет отправлена позже');
  if (target.kind === 'correction') throw new HttpError(400, 'Правку нельзя править');
  const empty = event.payload.data?.op === 'edit' && !event.payload.text?.trim();
  // A photo, voice or file may lose its caption; a text message would become nothing.
  if (empty && target.kind === 'text') throw new HttpError(400, 'Текст сообщения не может быть пустым. Чтобы убрать сообщение, удалите его');
}
