// Details of a case (task) in the right panel (CONCEPT.md §5): name, status and one-tap actions, roles, due date,
// the triage's note, the closing report, «Задача выполнена?», the whole conversation and the history of changes.
import { STATUSES, describeChange } from './taskfold.js';
import { actionsFor, actionLabel, changeFor, dueChips, partyName, delegateOptions } from './taskactions.js';

const clock = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 09:00 local on a day, as an ISO date-time with an offset.
const morning = (day) => new Date(`${day}T09:00:00`).toISOString();

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

// Roles as lines: only the filled ones.
function rolesBlock(task, views) {
  const box = element('div', 'details-roles');
  const { roles } = task;
  const lines = [['Ответственный', [roles.responsible]], ['Исполнитель', roles.executors], ['Контролёр', [roles.controller]], ['Постановщик', [roles.author]], ['Ждём', [task.waitingFor?.party]]];
  for (const [label, parties] of lines) {
    const names = parties.filter(Boolean).map((party) => partyName(party, views));
    if (names.length) box.append(element('div', 'details-fact', `${label} · ${names.join(', ')}`));
  }
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

  box.append(rolesBlock(task, views));
  const actions = element('div', 'task-actions');
  const choice = element('div', 'task-choice');
  box.append(actions, choice);
  const apply = (action, arg) => {
    const change = changeFor(action, task, arg);
    if (change === 'report') doneCards.start(task);
    else if (change) save({ op: 'update', ...change });
  };
  const pick = (action, options) => {
    choice.replaceChildren(element('p', 'picker-section', actionLabel(action)), ...options);
    choice.querySelector('button, input')?.focus({ preventScroll: true });
  };
  const partyButtons = (action, others) => [
    ...delegateOptions(views).map(({ party, name }) => button('chip suggest', name, () => apply(action, party))),
    ...(others ? [button('chip suggest', 'ИИ', () => apply(action, 'ai'))] : []),
    button('chip suggest', 'Другой…', () => {
      const name = (window.prompt('Кто? Имя или телефон') ?? '').trim();
      if (name) apply(action, /^\+\d+$/.test(name) ? `tel:${name}` : `name:${name}`);
    }),
  ];
  const ask = {
    delegate: () => pick('delegate', partyButtons('delegate', true)),
    wait: () => pick('wait', partyButtons('wait', false)),
    defer: () => {
      const input = Object.assign(document.createElement('input'), { type: 'date', className: 'details-due' });
      input.setAttribute('aria-label', 'Отложить до');
      input.onchange = () => input.value && apply('defer', morning(input.value));
      pick('defer', [...dueChips().map((chip) => button('chip suggest', chip.label, () => apply('defer', morning(chip.due)))), input]);
    },
  };
  const primary = new Set(['done', 'verify', 'accept']);
  for (const action of actionsFor(task)) {
    actions.append(button(primary.has(action) ? 'primary' : 'link-button', actionLabel(action), () => (ask[action] ? ask[action]() : apply(action))));
  }

  const due = Object.assign(document.createElement('input'), { type: 'date', value: task.due ? String(task.due).slice(0, 10) : '', className: 'details-due' });
  due.setAttribute('aria-label', 'Срок');
  due.onchange = () => save({ op: 'update', due: due.value || null });
  const chips = element('div', 'chips task-due');
  for (const chip of dueChips()) {
    const on = String(task.due ?? '').slice(0, 10) === chip.due;
    const node = button(`chip ${on ? 'on' : 'suggest'}`, chip.label, () => save({ op: 'update', due: chip.due }));
    node.setAttribute('aria-pressed', String(on));
    chips.append(node);
  }
  box.append(element('p', 'picker-section', 'Срок'), chips, due);

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
