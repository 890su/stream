// Details of a task in the right panel (CONCEPT.md §5, 2026-11-19), action first: name, status, «Задача
// выполнена?», one-tap actions (with «Вернуть»), due date; then roles in one folded line, the triage's note, the
// report («Заполнить отчёт» while fields are missing), the whole conversation and the folded history of changes.
import { STATUSES, describeChange } from './taskfold.js';
import { actionsFor, actionLabel, changeFor, dueChips, delegateOptions } from './taskactions.js';
import { partyName } from './parties.js';
import { checklistBlock } from './checklist.js';
import { projectLine } from './projectpanel.js';
import { counterpartyLine } from './counterpartyline.js';
import { holding } from './holdrender.js';

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
    input.setAttribute('aria-label', 'Название задачи');
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
  }, 'Переименовать задачу');
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

// Roles: folded into one line — who does it, else who answers for it; unfolded — every filled role.
function rolesBlock(task, views) {
  const { roles } = task;
  const lines = [['Исполнитель', roles.executors], ['Ответственный', [roles.responsible]], ['Контролёр', [roles.controller]], ['Постановщик', [roles.author]], ['Ждём', [task.waitingFor?.party]]]
    .map(([label, parties]) => [label, parties.filter(Boolean).map((party) => partyName(party, views))]).filter(([, names]) => names.length);
  if (!lines.length) return null;
  const box = element('details', 'details-roles');
  const [label, names] = lines[0];
  box.append(element('summary', 'details-fact', `${label} · ${names.join(', ')}${lines.length > 1 ? ' · ещё роли' : ''}`));
  for (const [line, people] of lines.slice(1)) box.append(element('div', 'details-fact', `${line} · ${people.join(', ')}`));
  return box;
}

export { personParty } from './parties.js'; // moved: the action bar types people in too (taskbar.js)

function personForm(onPick) {
  const form = element('form', 'details-rename');
  const input = Object.assign(document.createElement('input'), { maxLength: 115, enterKeyHint: 'done', placeholder: 'Имя или телефон' });
  input.setAttribute('aria-label', 'Кто: имя или телефон');
  form.append(input, button('link-button', 'Готово', () => form.requestSubmit()));
  form.onsubmit = (event) => {
    event.preventDefault();
    const party = personParty(input.value);
    if (party) onPick(party);
  };
  return form;
}

const MESSAGES = { done: 'Готово', verify: 'Проверено', accept: 'Принято', delegate: 'Поручено', defer: 'Отложено', wait: 'Ждём', reopen: 'Снова в работе', cancel: 'Отменено' };

// `ctx`: { views (the task's messages), bubble(view), save(change), saveTo(id, change), others (open tasks), notify,
// doneCards, quick (taskquick.js), reportKeys, fields }.
export function taskDetails(task, { views, bubble, save, saveTo, others, notify, projects = [], doneCards, quick, reportKeys = [], fields, directory = null }) {
  const box = element('div', 'details-task');
  box.append(titleBlock(task, save));
  const origin = task.createdBy === 'me' ? 'создано вами' : `создано разбором${task.confidence !== undefined ? ` · уверенность ${Math.round(task.confidence * 100)}%` : ''}`;
  box.append(element('p', 'details-meta', `${STATUSES[task.status] ?? task.status} · ${origin} · ${clock.format(new Date(task.createdAt))}`));
  const card = doneCards.card(task);
  if (card) box.append(card);

  // A change with «Вернуть» in the toast (taskquick.js).
  const act = (change, message) => (quick ? quick.act(task, change, message) : save({ op: 'update', ...change }));
  const actions = element('div', 'task-actions');
  const choice = element('div', 'task-choice');
  box.append(actions, choice);
  const apply = (action, arg) => {
    const change = changeFor(action, task, arg, new Date(), reportKeys);
    holding(choice, false);
    if (change) act(change, `${MESSAGES[action] ?? actionLabel(action)}: «${task.title}»`);
  };
  const pick = (action, options) => {
    choice.replaceChildren(element('p', 'picker-section', actionLabel(action)), ...options);
    holding(choice);
    choice.querySelector('button, input')?.focus({ preventScroll: true });
  };
  const partyButtons = (action, others) => [
    ...delegateOptions(views).map(({ party, name }) => button('chip suggest', name, () => apply(action, party))),
    ...(others ? [button('chip suggest', 'ИИ', () => apply(action, 'ai'))] : []),
    button('chip suggest', 'Другой…', () => pick(action, [personForm((party) => apply(action, party))])),
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
  const primary = new Set(['done', 'verify']);
  for (const action of actionsFor(task)) {
    const kind = primary.has(action) ? 'primary' : action === 'cancel' ? 'link-button muted' : 'link-button';
    actions.append(button(kind, actionLabel(action), () => (ask[action] ? ask[action]() : apply(action))));
  }

  if (!['done', 'cancelled'].includes(task.status)) {
    const due = Object.assign(document.createElement('input'), { type: 'date', value: task.due ? String(task.due).slice(0, 10) : '', className: 'details-due' });
    due.setAttribute('aria-label', 'Срок');
    due.onchange = () => act({ due: due.value || null }, due.value ? 'Срок изменён' : 'Срок снят');
    const chips = element('div', 'chips task-due');
    for (const chip of dueChips()) {
      const on = String(task.due ?? '').slice(0, 10) === chip.due;
      const node = button(`chip ${on ? 'on' : 'suggest'}`, chip.label, () => act({ due: chip.due }, `Срок «${chip.label}»`));
      node.setAttribute('aria-pressed', String(on));
      chips.append(node);
    }
    chips.append(due);
    box.append(element('p', 'picker-section', 'Срок'), chips);
  }

  box.append(projectLine(task, { projects, save })); // CONCEPT.md §2.11
  if (directory && !task.filed) box.append(counterpartyLine(task, { ...directory, save })); // contacts design §6
  const checklist = checklistBlock(task, { save, saveTo, others, notify });
  if (checklist) box.append(checklist);

  const roles = rolesBlock(task, views);
  if (roles) box.append(roles);
  if (task.note) box.append(element('p', 'details-meta', task.note));

  // A report belongs to a closed task; a task taken back into work («Вернуть») keeps it in the journal only.
  if (task.report && task.status === 'done') box.append(element('p', 'picker-section', 'Отчёт'), reportBlock(task.report, fields));
  if (task.status === 'done' && task.report?.missing?.length && !card) box.append(button('link-button', 'Заполнить отчёт', () => doneCards.start(task)));

  box.append(element('p', 'picker-section', `Переписка · ${views.length}`));
  const talk = element('div', 'details-talk');
  for (const view of views) {
    const line = element('div', 'details-message');
    line.append(bubble(view));
    if (task.messages.includes(view.id)) {
      line.append(button('icon-button details-unlink', '×', (event) => { event.stopPropagation(); save({ op: 'update', remove: [view.id] }); }, 'Убрать сообщение из задачи'));
    }
    talk.append(line);
  }
  if (!views.length) talk.append(element('p', 'drawer-empty', 'Сообщений нет'));
  box.append(talk);

  const history = element('details', 'details-history');
  history.append(element('summary', 'picker-section', `История · ${task.history?.length ?? 0}`));
  for (const item of [...(task.history ?? [])].reverse()) {
    const who = item.author === 'me' ? 'вы' : item.change?.processor ? 'разбор' : 'система';
    history.append(element('div', 'details-fact', `${clock.format(new Date(item.ts))} · ${who} · ${describeChange(item.change ?? {})}`));
  }
  box.append(history);
  return box;
}
