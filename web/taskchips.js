// The chips under the task's title (owner, 2026-11-20, after reviewing task managers: Todoist, TickTick, Things put
// «when I do it» and «the due date» apart, each a tap to change): 📅 Когда — the planned start and its length,
// ⏰ Срок — the due date, 🔁 — the repeat (the server makes the next one on closing, src/tasks/repeat.ts). chipFacts is
// pure (tested in node); taskChips builds the row and its editors.

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const weekday = new Intl.DateTimeFormat('ru', { weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });

const SHORT = { day: 'дн.', week: 'нед.', month: 'мес.', year: 'г.' };
export const durationLabel = (minutes) => (minutes < 60 ? `${minutes} мин` : minutes % 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes / 60} ч`);
const dateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

// A day in words from today: сегодня, завтра, else «ср 25 нояб.».
function dayWords(date, now) {
  const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
  return days === 0 ? 'сегодня' : days === 1 ? 'завтра' : days === -1 ? 'вчера' : `${weekday.format(date)} ${dayMonth.format(date)}`;
}

// { when, due, repeat, late } — the chips' words.
export function chipFacts(task, now = new Date(), repeats = []) {
  let when = 'Когда?';
  if (task.plan?.start) {
    const start = new Date(task.plan.start);
    when = `${dayWords(start, now)} ${pad(start.getHours())}:${pad(start.getMinutes())}${task.plan.duration_min ? ` · ${durationLabel(task.plan.duration_min)}` : ''}`;
  }
  let due = 'Срок?';
  let late = false;
  if (task.due) {
    const text = String(task.due);
    const onlyDay = dateOnly(text);
    const date = onlyDay ? new Date(`${text}T12:00:00`) : new Date(text);
    if (Number.isFinite(+date)) {
      due = `срок ${dayWords(date, now)}${onlyDay ? '' : ` ${pad(date.getHours())}:${pad(date.getMinutes())}`}`;
      late = onlyDay ? text < dayKey(now) : date < now;
    }
  }
  const repeat = !task.repeat ? 'Без повтора' : task.repeat.n === 1 ? repeats.find((item) => item.every === task.repeat.every)?.label ?? 'Повтор' : `каждые ${task.repeat.n} ${SHORT[task.repeat.every]}`;
  return { when, due, repeat, late };
}

// The card head's one line (owner, 2026-11-24: the conversation needs the room): only what is set — when, due,
// project, counterparty, repeat — as [{ key, text, late }]; a bare task has none. The triage's «В какой проект?»
// counts as set: it waits for an answer. The editors live in «Подробности» (taskChips).
export function filledFacts(task, { now = new Date(), repeats = [], projectTitle = null, counterpartyTitle = null } = {}) {
  const facts = chipFacts(task, now, repeats);
  const items = [];
  if (task.plan?.start) items.push({ key: 'when', text: `📅 ${facts.when}`, late: false });
  if (task.due) items.push({ key: 'due', text: `⏰ ${facts.due}`, late: facts.late });
  if (projectTitle) items.push({ key: 'project', text: `▸ ${projectTitle}`, late: false });
  else if (!task.project && task.project_options?.length) items.push({ key: 'project', text: '▸ В какой проект?', late: false });
  if (counterpartyTitle) items.push({ key: 'counterparty', text: `◆ ${counterpartyTitle}`, late: false });
  if (task.repeat) items.push({ key: 'repeat', text: `🔁 ${facts.repeat}`, late: false });
  return items;
}

// The head line: the set facts as quiet chips; a tap opens «Подробности» where they are edited. null — nothing set.
export function factsLine(items, onOpen) {
  if (!items.length) return null;
  const line = element('div', 'chips task-facts');
  for (const item of items) {
    const chip = button(`chip ${item.late ? 'late' : 'on'} task-chip`, item.text, onOpen, `${item.text} — изменить в подробностях`);
    line.append(chip);
  }
  return line;
}

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
const localInput = (iso) => {
  const date = new Date(iso);
  return iso && Number.isFinite(+date) ? `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}` : '';
};

// The row. ctx: { save(change), project (a node: the project line), counterparty (a node or null), now, dueChips() }.
export function taskChips(task, { save, project = null, counterparty = null, now = new Date(), dueChips = () => [], settings }) {
  const box = element('div', 'task-chips');
  const row = element('div', 'chips task-chips-row');
  const editor = element('div', 'task-chip-editor');
  const repeats = settings?.repeats ?? [];
  const facts = chipFacts(task, now, repeats);
  let openEditor = null;
  const triggers = new Map();
  const show = (key, nodes) => {
    openEditor = nodes ? key : null;
    for (const [id, trigger] of triggers) trigger.setAttribute('aria-expanded', String(id === openEditor));
    if (nodes) editor.dataset.holding = ''; else delete editor.dataset.holding;
    editor.replaceChildren(...(nodes ?? []));
  };
  const close = button('chip suggest muted', 'Закрыть', () => show(null));
  const done = (change) => { show(null); save({ op: 'update', ...change }); };

  const whenEditor = () => {
    const input = Object.assign(document.createElement('input'), { type: 'datetime-local', value: localInput(task.plan?.start) || `${dayKey(now)}T${pad(Math.min(now.getHours() + 1, 23))}:00` });
    input.setAttribute('aria-label', 'Начало');
    let minutes = task.plan?.duration_min ?? settings?.default_duration_min ?? 60;
    const durations = [...new Set([...(settings?.durations_min ?? []), minutes])].sort((a, b) => a - b);
    const lengths = element('div', 'chips');
    const drawLengths = () => lengths.replaceChildren(...durations.map((value) => {
      const chip = button(`chip ${value === minutes ? 'on' : 'suggest'}`, durationLabel(value), () => { minutes = value; drawLengths(); });
      chip.setAttribute('aria-pressed', String(value === minutes));
      return chip;
    }));
    drawLengths();
    return [element('span', 'picker-section', 'Когда делаю'), input, lengths,
      button('chip on', 'Готово', () => { if (input.value) done({ plan: { start: new Date(input.value).toISOString(), duration_min: minutes } }); }),
      ...(task.plan ? [button('chip suggest', 'Убрать', () => done({ plan: null }))] : []), close];
  };
  const dueEditor = () => {
    const timed = task.due && !dateOnly(task.due) && localInput(task.due);
    const input = Object.assign(document.createElement('input'), { type: timed ? 'datetime-local' : 'date', value: timed || task.due || '' });
    input.setAttribute('aria-label', 'Срок');
    return [element('span', 'picker-section', 'Срок'), ...dueChips(now).map((item) => button('chip suggest', item.label, () => done({ due: item.due }))),
      input, button('chip on', 'Готово', () => { if (input.value) done({ due: timed ? new Date(input.value).toISOString() : input.value }); }),
      ...(task.due ? [button('chip suggest', 'Убрать', () => done({ due: null }))] : []), close];
  };
  const repeatEditor = () => [element('span', 'picker-section', 'Повтор'),
    ...repeats.map((item) => button(`chip ${(task.repeat?.every ?? null) === item.every ? 'on' : 'suggest'}`, item.label, () => done({ repeat: item.every ? { every: item.every, n: 1 } : null }))), close];
  const editors = { when: whenEditor, due: dueEditor, repeat: repeatEditor };
  const chip = (key, icon, text, extra = '') => {
    const trigger = button(`chip ${extra || 'suggest'} task-chip`, `${icon} ${text}`, () => (openEditor === key ? show(null) : show(key, editors[key]())));
    trigger.setAttribute('aria-expanded', 'false');
    triggers.set(key, trigger);
    return trigger;
  };
  row.append(chip('when', '📅', facts.when, task.plan ? 'on' : ''), chip('due', '⏰', facts.due, facts.late ? 'late' : task.due ? 'on' : ''));
  if (project) row.append(project.trigger);
  if (counterparty) row.append(counterparty);
  if (repeats.length) row.append(chip('repeat', '🔁', facts.repeat, task.repeat ? 'on' : ''));
  box.append(row, editor);
  if (project) box.append(project.editor);
  return box;
}
