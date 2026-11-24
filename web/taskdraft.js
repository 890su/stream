// The draft of an assignment (#поручить, docs/plans/2026-11-23-conversation-records-design.md «Метка — указание»):
// the AI wrote the text to the executor into the task (`draft`); it waits in the input of the conversation with that
// person until I answer in that conversation (any message of mine after the task) or clear it (✕: `draft: ''`). Nothing is
// ever sent for me. Pure helpers plus the small line with ✕.
import { chatParties, replyChats } from './peoplerow.js';
import { personOf } from './contacts.js';
import { partyOfEvent } from './parties.js';

const OPEN = new Set(['inbox', 'todo', 'doing', 'waiting', 'review', 'deferred']);

// Any message of mine in this conversation after the task was made handles the draft: sent as it was, edited or
// replaced — it must not come back into the empty input (a second send).
export function draftSent(task, conversation) {
  return (conversation?.views ?? []).some((view) => !view.deleted && partyOfEvent(view.event) === 'me'
    && String(view.event.ts) > String(task.createdAt ?? ''));
}

// Is the party the executor — the same string or another point of the same directory person (tel:, tg:, …).
const same = (party, executor, people) => {
  if (party === executor) return true;
  const person = personOf(executor, people);
  return Boolean(person) && personOf(party, people)?.id === person.id;
};

// The open task with a draft whose executor is the one person of this private conversation, not handled or cleared
// yet: { task, text } or null. A group, or a conversation with anyone else too, never gets it.
export function pendingDraft(conversation, tasks, people = []) {
  if (!conversation || conversation.key === 'me' || conversation.key?.startsWith('task:')) return null;
  if (replyChats(conversation).some((chat) => chat.group)) return null;
  const others = chatParties(conversation).filter((party) => party !== 'me');
  if (!others.length) return null;
  const found = tasks.filter((task) => task.draft && OPEN.has(task.status)
    && (task.roles?.executors ?? []).some((executor) => others.every((party) => same(party, executor, people))) && !draftSent(task, conversation))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  return found ? { task: found, text: found.draft } : null;
}

// «Черновик поручения: «задача»» with ✕; `onDismiss` clears the draft.
export function draftLine(pending, { onDismiss }) {
  const line = document.createElement('div');
  line.className = 'draft-line';
  const label = document.createElement('span');
  label.textContent = `Черновик поручения: «${pending.task.title}»`;
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = '✕'; close.title = 'Убрать черновик'; close.setAttribute('aria-label', 'Убрать черновик поручения');
  close.onclick = () => onDismiss(pending);
  line.append(label, close);
  return line;
}
