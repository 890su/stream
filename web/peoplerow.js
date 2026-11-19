// Participants of an open conversation (owner's design, 2026-11-19): one sideways line over the tags row with the
// same tiles as the task card (participants.js). A conversation and its task have one set of participants and roles:
// the line edits the conversation's task. Without a task the line shows who writes in the chat, read-only.
// Pure helpers are tested in node.
import { participantsBlock } from './participants.js';
import { partyOfEvent } from './parties.js';
import { makeTaskChange, makePersonChange, makeCounterpartyChange } from './shared.js';

// The task of a conversation: the one it is named after (`task:<id>`), else its latest changed open task.
export function conversationTask(conversation) {
  if (!conversation) return null;
  const tasks = conversation.tasks ?? [];
  if (conversation.key?.startsWith('task:')) return tasks.find((task) => task.id === conversation.key.slice(5)) ?? null;
  const open = tasks.filter((task) => !task.filed && !['done', 'cancelled'].includes(task.status));
  return [...open].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null;
}

// Who writes in a conversation without a task: me and every other author, once.
export function chatParties(conversation) {
  const parties = ['me'];
  for (const view of conversation?.views ?? []) {
    if (view.deleted) continue;
    const party = partyOfEvent(view.event);
    if (party && !parties.includes(party)) parties.push(party);
  }
  return parties;
}

// deps: { feed, queue(entry), notify, openCounterparty(id) }
export function setupPeopleRow({ feed, queue, notify, openCounterparty }) {
  const row = document.querySelector('#people-row');
  const send = (entry) => queue(entry).catch((error) => notify(error.message));
  function render(conversation) {
    if (!conversation || conversation.key === 'me') { row.hidden = true; row.replaceChildren(); return; }
    const scroll = row.querySelector('.people-cloud')?.scrollLeft ?? 0;
    const task = conversationTask(conversation);
    const shown = task ?? { id: `conversation:${conversation.key}`, roles: { members: chatParties(conversation) }, muted: [] };
    row.replaceChildren(participantsBlock(shown, {
      strip: true, views: conversation.views, people: feed.people(), counterparties: feed.counterparties(),
      save: (change) => send(makeTaskChange(task.id, change)),
      savePerson: (id, change) => send(makePersonChange(id, change)), saveCounterparty: (id, change) => queue(makeCounterpartyChange(id, change)),
      onOpenCounterparty: openCounterparty,
      readOnly: task ? null : () => notify('Роли и участники — у задачи беседы: создайте её кнопкой «+ Задача»'),
    }));
    row.hidden = false;
    const cloud = row.querySelector('.people-cloud');
    if (cloud) cloud.scrollLeft = scroll;
  }
  return { render };
}
