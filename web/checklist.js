// The checklist of a task in its details (CONCEPT.md §2.8, 2026-11-19): tick an item, add one, «Отдельной задачей»
// (the item becomes a task of its own and leaves the list), and «В дело…» — this whole task becomes an item of
// another open task (its messages go there, this one is cancelled). Every change is one task_change.
import { isOpen, itemsProgress } from './taskfold.js';
import { holding } from './holdrender.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick, label) {
  const node = element('button', className, text);
  node.type = 'button';
  node.onclick = onClick;
  if (label) node.setAttribute('aria-label', label);
  return node;
}

const line = (text) => text.replace(/\s+/g, ' ').trim().slice(0, 200);

// `save(change)` — this task; `saveTo(id, change)` — another task; `others` — open tasks it may join, likely first.
export function checklistBlock(task, { save, saveTo, others = [], notify }) {
  const open = isOpen(task);
  const box = element('div', 'checklist');
  if (!open && !task.items?.length) return null;
  box.append(element('p', 'picker-section', `Чеклист${task.items?.length ? ` · ${itemsProgress(task)}` : ''}`));
  for (const item of task.items ?? []) {
    const row = element('div', `checklist-item${item.done ? ' done' : ''}`);
    const tick = button('checklist-tick', item.done ? '☑' : '☐', () => save({ op: 'update', items_set: [{ id: item.id, done: !item.done }] }), item.done ? `Не сделано: ${item.text}` : `Сделано: ${item.text}`);
    tick.setAttribute('aria-pressed', String(item.done));
    row.append(tick, element('span', 'checklist-text', item.text));
    if (open && !item.done) {
      row.append(button('icon-button checklist-out', '↗', async () => {
        const id = crypto.randomUUID();
        await saveTo(id, { op: 'create', title: item.text, roles: { author: 'me', responsible: 'me', executors: ['me'] }, status: 'todo', add: task.messages.slice(-1) });
        save({ op: 'update', items_remove: [item.id] });
        notify(`Отдельной задачей: «${item.text}»`);
      }, `Отдельной задачей: ${item.text}`));
    }
    box.append(row);
  }
  if (!open) return box;

  const form = element('form', 'checklist-add');
  const input = Object.assign(document.createElement('input'), { maxLength: 200, enterKeyHint: 'done', placeholder: 'Пункт' });
  input.setAttribute('aria-label', 'Новый пункт чеклиста');
  form.append(input, button('link-button', 'Добавить', () => form.requestSubmit()));
  form.onsubmit = (event) => {
    event.preventDefault();
    const text = line(input.value);
    if (text) save({ op: 'update', items_add: [{ id: crypto.randomUUID(), text }] });
  };
  box.append(form);

  // «В дело…»: this task as an item of another one.
  const targets = others.filter((other) => other.id !== task.id && isOpen(other) && !other.filed).slice(0, 6);
  if (targets.length) {
    const choice = element('div', 'chips checklist-into');
    const into = button('link-button', 'В дело…', () => {
      holding(choice);
      choice.replaceChildren(...targets.map((other) => button('chip suggest', other.title, async () => {
        holding(choice, false);
        await saveTo(other.id, { op: 'update', add: task.messages, items_add: [{ id: crypto.randomUUID(), text: line(task.title) }] });
        save({ op: 'update', status: 'cancelled' });
        notify(`«${task.title}» — пункт дела «${other.title}»`);
      })));
    }, 'Сделать эту задачу пунктом другого дела');
    box.append(into, choice);
  }
  return box;
}
