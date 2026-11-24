// The draft of an assignment (#поручить, docs/plans/2026-11-23-conversation-records-design.md «Метка — указание»):
// the AI wrote the text to the executor into the task (`draft`); it waits in the input of the conversation with that
// person until I send it (my own message that equals it or starts with it) or clear it (✕: `draft: ''`). Nothing is
// ever sent for me. Pure helpers plus the small line with ✕.
import { chatParties } from './peoplerow.js';
import { partyOfEvent } from './parties.js';

const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const OPEN = new Set(['inbox', 'todo', 'doing', 'waiting', 'review', 'deferred']);

// My message in this conversation after the task was made that is the draft (as it was or with more after it).
export function draftSent(task, conversation) {
  const draft = norm(task.draft);
  return (conversation?.views ?? []).some((view) => !view.deleted && partyOfEvent(view.event) === 'me'
    && String(view.event.ts) > String(task.createdAt ?? '') && norm(view.text).startsWith(draft));
}

// The open task with a draft for someone of this conversation that is not sent or cleared yet: { task, text } or null.
export function pendingDraft(conversation, tasks) {
  if (!conversation || conversation.key === 'me' || conversation.key?.startsWith('task:')) return null;
  const parties = chatParties(conversation).filter((party) => party !== 'me');
  const found = tasks.filter((task) => task.draft && OPEN.has(task.status)
    && (task.roles?.executors ?? []).some((party) => parties.includes(party)) && !draftSent(task, conversation))
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
