import { HttpError } from '../server/errors.ts';
import type { JournalEvent } from './validate.ts';

// Owner actions on a message are new journal events (CONCEPT.md §2.4); the original never changes.
export const CORRECTION_OPS = ['edit', 'archive', 'unarchive', 'delete', 'restore', 'link', 'unlink', 'topic'] as const;

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
  if (op === 'topic') {
    const title = event.payload.data?.title;
    if (typeof title !== 'string' || !title.trim() || title.length > 80) throw new HttpError(400, 'Название темы — от 1 до 80 знаков');
  }
  if (op === 'link') {
    const target = event.payload.data?.target;
    if (typeof target !== 'string' || !/^[0-9a-f-]{36}$/i.test(target)) throw new HttpError(400, 'Связь должна указывать target — id сообщения');
    if (target === ref.id) throw new HttpError(400, 'Сообщение нельзя связать с самим собой');
  }
}

// Targets of connections (CONCEPT.md §2.5): a continuation chosen at capture or a later `link`
// must point to an accepted message that is not itself a correction.
export function linkTargets(event: JournalEvent): string[] {
  const data = event.payload.data as { continuation?: { target: string }; op?: string; target?: string } | undefined;
  const targets: string[] = [];
  if (data?.continuation) targets.push(data.continuation.target);
  if (event.kind === 'correction' && data?.op === 'link' && data.target) targets.push(data.target);
  return targets;
}

export function checkLinkTarget(target: JournalEvent | undefined): void {
  if (!target) throw new HttpError(422, 'Связанное сообщение ещё не принято. Запись будет отправлена позже');
  if (target.kind === 'correction') throw new HttpError(400, 'Связать можно только с сообщением, не с правкой');
}

export function checkCorrectionTarget(event: JournalEvent, target: JournalEvent | undefined): void {
  if (event.kind !== 'correction') return;
  if (!target) throw new HttpError(422, 'Исходное сообщение ещё не принято. Правка будет отправлена позже');
  if (target.kind === 'correction') throw new HttpError(400, 'Правку нельзя править');
  const empty = event.payload.data?.op === 'edit' && !event.payload.text?.trim();
  // A photo, voice or file may lose its caption; a text message would become nothing.
  if (empty && target.kind === 'text') throw new HttpError(400, 'Текст сообщения не может быть пустым. Чтобы убрать сообщение, удалите его');
}
