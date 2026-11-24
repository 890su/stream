// The owner's orders to the triage (triage-ai-v21). Directive tags (registry/tags.json "directive": true): the owner's
// tag on a message is an order — give a record of that kind or say why not. A directive tag added to a message the
// triage has already looked at sends its session to the triage again at once (Triage.rerun). Tags the composer switched
// on by itself from hint words (payload.data.tagging.auto, web/tagrow.js) are no order unless the owner kept them in an
// edit. An answer in his own words to the AI's question (`answer_question` with `text`, web/askline.js) sends the
// question's session again with that answer as his order (Triage.rerun, planner `owner_answers`).
import type { JournalStore } from '../store/store.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import { tagConfig } from '../config.ts';
import type { OwnerAnswer } from './planner.ts';

const DIRECTIVE = new Set(tagConfig.tags.filter((tag) => tag.directive).map((tag) => tag.tag));

export const directiveOf = (tags: string[]): string[] => tags.filter((tag) => DIRECTIVE.has(tag));

// The owner's tags of a message after `edits` (his edit corrections, oldest first): the last edit's list — he saw them —,
// else the capture tags without those switched on automatically.
function ownerTags(message: JournalEvent, edits: JournalEvent[]): string[] {
  const edit = edits.filter((item) => item.author === 'me' && item.payload.data?.op === 'edit').at(-1);
  if (edit) return edit.payload.tags ?? []; // an edit without tags removed them all
  const auto = new Set(((message.payload.data?.tagging as { auto?: string[] } | undefined)?.auto) ?? []);
  return (message.payload.tags ?? []).filter((tag) => !auto.has(tag));
}

// The directive tags the owner put on a message, as it is now.
export const directivesOf = (message: JournalEvent, store: JournalStore): string[] => directiveOf(ownerTags(message, store.triage.corrections(message.id)));

// An owner's edit that adds a directive tag to a message already triaged → that message's id, else null.
export function directiveAdded(store: JournalStore, event: JournalEvent): string | null {
  if (event.kind !== 'correction' || event.author !== 'me' || event.payload.data?.op !== 'edit') return null;
  const id = event.payload.ref?.id;
  const message = id ? store.getEvent(id) : null;
  if (!id || !message || !store.triage.wasTriaged(id)) return null;
  const corrections = store.triage.corrections(id);
  const at = corrections.findIndex((correction) => correction.id === event.id);
  const before = new Set(directiveOf(ownerTags(message, at < 0 ? corrections : corrections.slice(0, at))));
  return directiveOf(event.payload.tags ?? []).some((tag) => !before.has(tag)) ? id : null;
}

// An owner's answer in words to a question of a triage result → the message to send again (the question's first) and
// the answer for the planner, else null.
export function ownerAnswerOf(store: JournalStore, event: JournalEvent): { message: string; answer: OwnerAnswer } | null {
  const data = event.payload.data as { op?: string; question?: string; text?: string } | undefined;
  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  if (event.kind !== 'correction' || event.author !== 'me' || data?.op !== 'answer_question' || !data.question || !text) return null;
  for (const result of store.triage.results()) {
    const questions = ((result.payload.data?.triage ?? {}) as { questions?: { id: string; message_ids: string[] }[] }).questions ?? [];
    const question = questions.find((item) => item.id === data.question);
    if (question?.message_ids.length) return { message: question.message_ids[0]!, answer: { message_ids: question.message_ids, text: text.slice(0, 500) } };
  }
  return null;
}
