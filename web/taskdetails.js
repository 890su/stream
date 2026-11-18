// Details of a case (task) in the right panel (CONCEPT.md §5): name, status and actions, assignee, due date,
// the triage's note, the closing report, «Задача выполнена?», the whole conversation and the history of changes.
import { ASSIGNEES, STATUSES, isOpen, describeChange } from './taskfold.js';

const clock = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

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

function titleBlock(task, save) {
  const title = button('details-title', task.title, () => {
    const form = element('form', 'details-rename');
    const input = Object.assign(document.createElement('input'), { value: task.title, maxLength: 200, enterKeyHint: 'done' });
    input.setAttribute('aria-label', 'Название дела');
    form.append(input, button('link-button', 'Готово', () => form.requestSubmit()));
    form.onsubmit = (event) => {
      event.preventDefault();
      const next = input.value.trim();
      if (next && next !== task.title) save({ op: 'update', title: next });
      form.replaceWith(titleBlock({ ...task, title: next || task.title }, save));
    };
    title.replaceWith(form);
    input.focus();
    input.select();
  }, 'Переименовать дело');
  return title;
}

function reportBlock(report, fields) {
  const box = element('div', 'details-report');
  for (const [key, value] of Object.entries(report)) {
    if (key === 'missing' || key === 'currency' || !fields[key]) continue;
    const shown = fields[key].type === 'money' ? `${value} ${report.currency ?? ''}`.trim()
      : fields[key].type === 'datetime' ? clock.format(new Date(value)) : Array.isArray(value) ? value.join(' ') : String(value);
    box.append(element('div', 'details-fact', `${fields[key].title}: ${shown}`));
  }
  if (report.missing?.length) box.append(element('div', 'details-fact muted', `Не заполнено: ${report.missing.map((key) => fields[key]?.title ?? key).join(', ')}`));
  return box;
}

// `ctx`: { views (the case's messages), bubble(view), save(change), doneCards, fields (report fields) }.
export function taskDetails(task, { views, bubble, save, doneCards, fields }) {
  const box = element('div', 'details-task');
  box.append(titleBlock(task, save));
  const origin = task.createdBy === 'me' ? 'создано вами' : `создано разбором${task.confidence !== undefined ? ` · уверенность ${Math.round(task.confidence * 100)}%` : ''}`;
  box.append(element('p', 'details-meta', `${STATUSES[task.status] ?? task.status} · ${origin} · ${clock.format(new Date(task.createdAt))}`));
  if (task.note) box.append(element('p', 'details-meta', task.note));
  const card = doneCards.card(task);
  if (card) box.append(card);

  const actions = element('div', 'task-actions');
  if (isOpen(task)) {
    actions.append(button('primary', 'Готово', () => doneCards.start(task)));
    if (task.status === 'inbox') actions.append(button('link-button', 'Принять', () => save({ op: 'update', status: 'todo' })));
    actions.append(button('link-button', 'Отменить', () => save({ op: 'update', status: 'cancelled' })));
  } else actions.append(button('link-button', 'Вернуть в работу', () => save({ op: 'update', status: 'todo' })));
  box.append(actions);

  const assignees = element('div', 'chips task-assignees');
  for (const [key, label] of Object.entries(ASSIGNEES)) {
    const chip = button(`chip ${task.assignee === key ? 'on' : 'suggest'}`, label, () => save({ op: 'update', assignee: key }));
    chip.setAttribute('aria-pressed', String(task.assignee === key));
    assignees.append(chip);
  }
  box.append(element('p', 'picker-section', 'Исполнитель'), assignees);

  const due = Object.assign(document.createElement('input'), { type: 'date', value: task.due ? String(task.due).slice(0, 10) : '', className: 'details-due' });
  due.setAttribute('aria-label', 'Срок');
  due.onchange = () => save({ op: 'update', due: due.value || null });
  box.append(element('p', 'picker-section', 'Срок'), due);

  if (task.report) box.append(element('p', 'picker-section', 'Отчёт'), reportBlock(task.report, fields));

  box.append(element('p', 'picker-section', `Переписка · ${views.length}`));
  const talk = element('div', 'details-talk');
  for (const view of views) {
    const line = element('div', 'details-message');
    line.append(bubble(view));
    if (task.messages.includes(view.id)) {
      line.append(button('icon-button details-unlink', '×', (event) => { event.stopPropagation(); save({ op: 'update', remove: [view.id] }); }, 'Убрать сообщение из дела'));
    }
    talk.append(line);
  }
  if (!views.length) talk.append(element('p', 'drawer-empty', 'Сообщений нет'));
  box.append(talk);

  box.append(element('p', 'picker-section', 'История'));
  const history = element('div', 'details-history');
  for (const item of [...(task.history ?? [])].reverse()) {
    const who = item.author === 'me' ? 'вы' : item.change?.processor ? 'разбор' : 'система';
    history.append(element('div', 'details-fact', `${clock.format(new Date(item.ts))} · ${who} · ${describeChange(item.change ?? {})}`));
  }
  box.append(history);
  return box;
}
