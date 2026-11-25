import { HttpError } from '../server/errors.ts';
import type { JournalEvent } from './validate.ts';

// Owner actions on a message are new journal events (CONCEPT.md §2.4); the original never changes.
export const CORRECTION_OPS = ['edit', 'archive', 'unarchive', 'delete', 'restore', 'link', 'unlink', 'topic', 'topic_archive', 'topic_unarchive', 'untrack', 'track', 'remote_delete', 'pin', 'unpin', 'answered', 'unanswered', 'split', 'unsplit', 'snooze', 'unsnooze', 'requeue', 'unrequeue', 'read', 'reject_proposal', 'answer_question'] as const;

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
  // «⏱ Отложить» on a conversation (CONCEPT.md §2.5, the queue): until when it stays out of the queue.
  if (op === 'snooze') {
    const until = event.payload.data?.until;
    if (typeof until !== 'string' || Number.isNaN(Date.parse(until))) throw new HttpError(400, 'Отложить можно только до даты и времени (until)');
  }
  // «✕» under an AI proposal (docs/plans/2026-11-21-ai-proposals-design.md): which proposal is rejected.
  if (op === 'reject_proposal') {
    const proposal = event.payload.data?.proposal;
    if (typeof proposal !== 'string' || !/^[0-9a-f-]{36}$/i.test(proposal)) throw new HttpError(400, 'Отказ от предложения ИИ должен указывать proposal — id предложения');
  }
  // The owner's answer to an AI question (triage-ai-v21 `ask`, design 2026-11-23): one of its options by index, or words.
  if (op === 'answer_question') {
    const { question, option, text } = event.payload.data ?? {};
    if (typeof question !== 'string' || !/^[0-9a-f-]{36}$/i.test(question)) throw new HttpError(400, 'Ответ на вопрос ИИ должен указывать question — id вопроса');
    if ((option === undefined) === (text === undefined)) throw new HttpError(400, 'Ответ на вопрос ИИ — либо вариант (option), либо слова (text)');
    if (option !== undefined && !(Number.isInteger(option) && (option as number) >= 0 && (option as number) <= 2)) throw new HttpError(400, 'Ответ на вопрос ИИ: option — номер варианта от 0 до 2');
    if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > 500)) throw new HttpError(400, 'Ответ на вопрос ИИ словами — от 1 до 500 знаков');
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
  // "Не отслеживать" / back (CONCEPT.md §8.2) name a chat through one of its messages.
  const op = event.payload.data?.op;
  if ((op === 'untrack' || op === 'track') && !target.payload.data?.telegram) throw new HttpError(400, 'Не отслеживать можно только чат мессенджера');
  // Pinning a recipient of the «кому» row (CONCEPT.md §2.9) names the chat through a message of it.
  if ((op === 'pin' || op === 'unpin') && !target.payload.data?.telegram && !target.payload.data?.outbound) throw new HttpError(400, 'Закрепить можно только чат мессенджера');
  const empty = event.payload.data?.op === 'edit' && !event.payload.text?.trim();
  // A photo, voice or file may lose its caption; a text message would become nothing.
  if (empty && target.kind === 'text') throw new HttpError(400, 'Текст сообщения не может быть пустым. Чтобы убрать сообщение, удалите его');
}
