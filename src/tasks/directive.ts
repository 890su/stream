// Directive tags (registry/tags.json "directive": true, triage-ai-v21): the owner's tag on a message is an order to the
// triage — give a record of that kind or say why not. A directive tag added to a message the triage has already looked
// at sends its session to the triage again at once (Triage.rerun).
import type { JournalStore } from '../store/store.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import { tagConfig } from '../config.ts';

const DIRECTIVE = new Set(tagConfig.tags.filter((tag) => tag.directive).map((tag) => tag.tag));

export const directiveOf = (tags: string[]): string[] => tags.filter((tag) => DIRECTIVE.has(tag));

// An owner's edit that adds a directive tag to a message already triaged → that message's id, else null.
export function directiveAdded(store: JournalStore, event: JournalEvent): string | null {
  if (event.kind !== 'correction' || event.author !== 'me' || event.payload.data?.op !== 'edit') return null;
  const id = event.payload.ref?.id;
  const message = id ? store.getEvent(id) : null;
  if (!id || !message || !store.triage.wasTriaged(id)) return null;
  let tags = message.payload.tags ?? []; // the tags before this edit, as describe() reads them
  for (const correction of store.triage.corrections(id)) {
    if (correction.id === event.id) break;
    if (correction.payload.data?.op === 'edit') tags = correction.payload.tags ?? []; // an edit without tags removed them all
  }
  const before = new Set(tags);
  return directiveOf(event.payload.tags ?? []).some((tag) => !before.has(tag)) ? id : null;
}
