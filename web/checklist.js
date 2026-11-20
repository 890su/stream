// Renders and edits checklist items in a task card.
import { isOpen, itemsProgress } from './taskfold.js';

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

export function checklistBlock(task, { save, saveTo, notify }) {
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
        const added = await saveTo(id, { op: 'create', title: item.text, roles: { author: 'me', responsible: 'me', executors: ['me'] }, status: 'todo', add: task.messages.slice(-1) });
        if (added === false) return;
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
  const add = element('button', 'icon-button checklist-plus');
  add.type = 'submit';
  add.setAttribute('aria-label', 'Добавить пункт чеклиста');
  add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8m-4-4h8"/></svg>';
  add.disabled = true;
  input.oninput = () => { add.disabled = !line(input.value); };
  form.append(input, add);
  form.onsubmit = async (event) => {
    event.preventDefault();
    const draft = input.value;
    const text = line(draft);
    if (!text) return;
    input.value = '';
    add.disabled = true;
    input.focus();
    if (await save({ op: 'update', items_add: [{ id: crypto.randomUUID(), text }] }) === false && input.isConnected && !input.value) {
      input.value = draft;
      input.oninput();
    }
  };
  box.append(form);

  return box;
}
