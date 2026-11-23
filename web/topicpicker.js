// «Тема…» for selected messages (topics design 2026-11-23): a sheet with the live records of this conversation, live
// topics of other conversations and open tasks (topiclive.js pickable), a search by title and «+ Новая тема»; then
// «Перенести» (out of every other record, into the chosen one) or «Добавить» (one more). A topic left with no messages
// is closed, a task is not. Pure helpers (moveChanges, undoChanges, filterGroups) are tested in node.
import { isTopic } from './topickind.js';

const CLOSED = { status: 'cancelled', reason: 'Убрана из бесед' };

// → [{ id, change }]: the add into `targetId` (messages not there yet), and for `move` a remove from every other
// record holding any of them.
export function moveChanges(views, targetId, mode, tasksById) {
  const ids = views.map((view) => view.id);
  const target = tasksById.get(targetId);
  const add = ids.filter((id) => !(target?.messages ?? []).includes(id));
  const changes = add.length ? [{ id: targetId, change: { op: 'update', add } }] : [];
  if (mode !== 'move') return changes;
  const holders = [];
  for (const view of views) for (const id of view.taskIds ?? []) if (id !== targetId && !holders.includes(id)) holders.push(id);
  for (const id of holders) {
    const task = tasksById.get(id);
    if (!task) continue;
    const remove = ids.filter((message) => (task.messages ?? []).includes(message));
    if (!remove.length) continue;
    const left = (task.messages ?? []).filter((message) => !remove.includes(message));
    changes.push({ id, change: { op: 'update', remove, ...(isTopic(task) && !left.length ? CLOSED : {}) } });
  }
  return changes;
}

// The changes that take moveChanges back: adds become removes and the other way round; a closed topic reopens.
export function undoChanges(changes, tasksById) {
  return changes.map(({ id, change }) => ({ id, change: change.add
    ? { op: 'update', remove: change.add }
    : { op: 'update', add: change.remove, ...(change.status ? { status: tasksById.get(id)?.status ?? 'todo' } : {}) } }));
}

// The groups whose titles contain every word of `query` (case-insensitive).
export function filterGroups(groups, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  const keep = (list) => list.filter((task) => words.every((word) => String(task.title ?? '').toLowerCase().includes(word)));
  return { here: keep(groups.here), other: keep(groups.other), tasks: keep(groups.tasks) };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// `groups` — pickable(); `count` — how many messages; `onPick(target, mode)` — target is an id or { title } for a new
// topic, mode 'move' | 'add'.
export function openTopicPicker({ groups, count, onPick }) {
  const dialog = element('dialog', 'topic-picker');
  dialog.setAttribute('aria-label', 'Тема для выбранных сообщений');
  let target = null; // an id or { title }
  const head = element('p', 'topic-picker-head', `Тема… · сообщений: ${count}`);
  const search = Object.assign(element('input', 'topic-picker-search'), { type: 'search', placeholder: 'Найти тему или задачу' });
  const list = element('div', 'topic-picker-list');
  const fresh = Object.assign(element('input', 'topic-picker-new'), { placeholder: '+ Новая тема' });
  fresh.setAttribute('aria-label', 'Новая тема: название');
  const move = Object.assign(element('button', 'chip', 'Перенести'), { type: 'button' });
  const add = Object.assign(element('button', 'chip', 'Добавить'), { type: 'button' });
  const cancel = Object.assign(element('button', 'link-button', 'Отмена'), { type: 'button' });
  const actions = element('div', 'topic-picker-actions');
  actions.append(move, add, cancel);

  const ready = () => { move.disabled = add.disabled = !target; };
  function draw() {
    const shown = filterGroups(groups, search.value);
    const nodes = [];
    for (const [title, items] of [['Эта беседа', shown.here], ['Другие темы', shown.other], ['Задачи', shown.tasks]]) {
      if (!items.length) continue;
      nodes.push(element('p', 'picker-section', title));
      for (const task of items) {
        const row = Object.assign(element('button', `topic-picker-item${target === task.id ? ' on' : ''}`, `${isTopic(task) ? '◇' : '☑'} ${task.title}`), { type: 'button' });
        row.setAttribute('aria-pressed', String(target === task.id));
        row.onclick = () => { target = task.id; fresh.value = ''; draw(); ready(); };
        nodes.push(row);
      }
    }
    if (!nodes.length) nodes.push(element('p', 'system-empty', 'Ничего не найдено — назовите новую тему'));
    list.replaceChildren(...nodes);
  }
  search.oninput = draw;
  fresh.oninput = () => { target = fresh.value.trim() ? { title: fresh.value.trim().slice(0, 120) } : null; draw(); ready(); };
  const pick = (mode) => { if (!target) return; dialog.close(); onPick(target, mode); };
  move.onclick = () => pick('move');
  add.onclick = () => pick('add');
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  dialog.append(head, search, list, fresh, actions);
  document.body.append(dialog);
  draw();
  ready();
  dialog.showModal();
}
