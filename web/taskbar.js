// One action bar for a task (task card design §3) — at the bottom of the task card and in the sheet a long press opens
// (tasksheet.js): ✓ Готово · ▶ В работу · 🕒 Когда · 👤 Поручить · 💬 Ответить · ⋯ Ещё. A second level (dates, people,
// «Ещё») shows above the icons in the same bar. Every change goes through taskquick.js with «Вернуть» in the toast.
// The sets of actions are pure and tested in node.
import { changeFor, dueChips, delegateOptions } from './taskactions.js';
import { holding } from './holdrender.js';
import { personParty } from './parties.js';

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

const CLOSED = new Set(['done', 'cancelled']);

// The bar's icons for a task: `mine` — I do it (▶ / ⏸), `hasChat` — it has a conversation to answer in.
export function barActions(task, { mine = false, hasChat = false } = {}) {
  const reply = hasChat ? [{ id: 'reply', icon: '💬', label: 'Ответить' }] : [];
  if (CLOSED.has(task.status)) return [{ id: 'reopen', icon: '↺', label: 'Вернуть' }, ...reply];
  const finish = task.status === 'review' && task.roles?.controller === 'me' ? { id: 'verify', icon: '✓', label: 'Проверил' } : { id: 'done', icon: '✓', label: 'Готово' };
  const work = !mine ? [] : task.status === 'doing' ? [{ id: 'pause', icon: '⏸', label: 'Пауза' }] : [{ id: 'start', icon: '▶', label: 'В работу' }];
  return [finish, ...work, { id: 'when', icon: '🕒', label: 'Когда' }, { id: 'delegate', icon: '👤', label: 'Поручить' }, ...reply, { id: 'more', icon: '⋯', label: 'Ещё' }];
}

// «Ещё»: what is used less often.
export function moreActions(task) {
  return [...(task.status === 'inbox' ? [{ id: 'accept', label: 'Принять' }] : []), { id: 'wait', label: 'Жду…' }, { id: 'defer', label: 'Отложить…' }, { id: 'cancel', label: 'Отменить' }];
}

const morning = (day) => new Date(`${day}T09:00:00`).toISOString();

// «Другой…»: a name or a phone number typed in.
export function personForm(onPick) {
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

// ctx: { mine, hasChat, views (the task's messages), current (the task in work), quick (taskquick.js), onReply(),
//   onDone() — after an action (the sheet closes) }
export function actionBar(task, ctx) {
  const bar = element('div', 'task-bar');
  const level = element('div', 'task-bar-level');
  const icons = element('div', 'task-bar-icons');
  bar.append(level, icons);
  const finish = () => { holding(level, false); level.replaceChildren(); ctx.onDone?.(); };
  const run = (action, arg, message) => { const change = changeFor(action, task, arg); if (change) ctx.quick.act(task, change, message); finish(); };
  // A second level above the icons; the same icon again closes it.
  let open = null;
  const show = (id, nodes) => {
    if (open === id) { open = null; holding(level, false); level.replaceChildren(); return; }
    open = id;
    holding(level);
    level.replaceChildren(...nodes);
    level.querySelector('button, input')?.focus({ preventScroll: true });
  };
  const people = (action, message, withAi) => [
    ...delegateOptions(ctx.views ?? []).map(({ party, name }) => button('chip suggest', name, () => run(action, party, message))),
    ...(withAi ? [button('chip suggest', 'ИИ', () => run(action, 'ai', message))] : []),
    button('chip suggest', 'Другой…', () => show(`${action}-other`, [personForm((party) => run(action, party, message))])),
  ];
  const dates = (onPick) => {
    const input = Object.assign(document.createElement('input'), { type: 'date', className: 'details-due' });
    input.setAttribute('aria-label', 'Дата');
    input.onchange = () => input.value && onPick(input.value, input.value.split('-').reverse().join('.'));
    return [...dueChips().map((chip) => button('chip suggest', chip.label, () => onPick(chip.due, chip.label))), input];
  };
  const handlers = {
    done: () => { ctx.quick.done(task); finish(); },
    verify: () => { ctx.quick.done(task); finish(); },
    reopen: () => run('reopen', undefined, `Снова в работе: «${task.title}»`),
    start: () => { ctx.quick.start(task, ctx.current); finish(); },
    pause: () => { ctx.quick.pause(task); finish(); },
    when: () => show('when', dates((due, label) => { ctx.quick.act(task, { due }, `Срок «${label}»: «${task.title}»`); finish(); })),
    delegate: () => show('delegate', people('delegate', `Поручено: «${task.title}»`, true)),
    reply: () => { finish(); ctx.onReply?.(); },
    more: () => show('more', moreActions(task).map((item) => button('chip suggest', item.label, () => {
      if (item.id === 'wait') show('wait', people('wait', `Ждём: «${task.title}»`, false));
      else if (item.id === 'defer') show('defer', dates((day, label) => run('defer', morning(day), `Отложено до «${label}»: «${task.title}»`)));
      else run(item.id, undefined, `${item.label}: «${task.title}»`);
    }))),
  };
  for (const action of barActions(task, ctx)) {
    const node = button(`task-bar-button ${action.id}`, '', handlers[action.id], action.label);
    node.append(element('span', 'task-bar-icon', action.icon), element('span', 'task-bar-label', action.label));
    icons.append(node);
  }
  return bar;
}
