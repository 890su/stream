// The card «Задача выполнена?» (CONCEPT.md §2.9, 2026-11-19): under a task the triage saw «готово» on — «Да»
// closes it in one tap (`close`, with «Вернуть»), «Ещё нет» drops the question. «Заполнить отчёт» on a closed task
// (start) shows the fields still missing (registry/tasks.json); saving keeps the task closed and fills its report,
// empty fields stay missing for the evening summary.
import { makeTaskChange } from './shared.js';
import { play } from './motion.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const node = element('button', className, text);
  node.type = 'button';
  node.onclick = onClick;
  return node;
}

// Fields of the report for a task: by its template, else the default list.
export const reportKeys = (task, tasks) => tasks?.reports?.[task.template] ?? tasks?.report_default ?? [];

// Minutes from «90», «1:30», «1,5 ч» or «2 ч»; null when it is not a duration.
export function parseMinutes(raw) {
  const text = raw.trim().toLowerCase().replace(',', '.');
  const clock = /^(\d+):(\d{1,2})$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const hours = /^(\d+(?:\.\d+)?)\s*ч/.exec(text);
  if (hours) return Math.round(Number(hours[1]) * 60);
  const minutes = /^(\d+)\s*(?:м|мин)?\.?$/.exec(text);
  return minutes ? Number(minutes[1]) : null;
}

// The report from what was typed. Pure: { report } or { error } with the field's title.
export function buildReport(keys, values, fields, currency) {
  const report = {};
  const missing = [];
  for (const key of keys) {
    const field = fields[key];
    const raw = String(values[key] ?? '').trim();
    if (!field) continue;
    if (!raw) { missing.push(key); continue; }
    if (field.type === 'minutes') {
      const minutes = parseMinutes(raw);
      if (minutes === null) return { error: `«${field.title}»: например 90, 1:30 или 1,5 ч` };
      report[key] = minutes;
    } else if (field.type === 'money') {
      const amount = Number(raw.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(amount) || amount < 0) return { error: `«${field.title}»: сумма числом` };
      report[key] = amount;
    } else if (field.type === 'datetime') {
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return { error: `«${field.title}»: дата и время` };
      report[key] = date.toISOString();
    } else if (field.type === 'tags') {
      report[key] = [...new Set(raw.split(/[\s,]+/).filter(Boolean).map((tag) => `#${tag.replace(/^#+/, '').toLowerCase()}`))];
    } else report[key] = raw.slice(0, 500);
  }
  if (keys.some((key) => fields[key]?.type === 'money' && key in report)) report.currency = currency;
  report.missing = missing;
  return { report };
}

const INPUT = { minutes: { type: 'text', inputMode: 'decimal', placeholder: '90 или 1:30' }, money: { type: 'text', inputMode: 'decimal', placeholder: '0' },
  datetime: { type: 'datetime-local' }, tags: { type: 'text', placeholder: '#метка' }, text: { type: 'text', placeholder: '' } };

export function createDoneCards({ config, queue, notify, onChange = () => {}, close = () => {} }) {
  const tasks = config.tasks ?? {};
  const cards = new Map(); // task id -> { node, step, task, manual }
  const save = (task, change) => queue(makeTaskChange(task.id, change)).catch((error) => notify(error.message));

  function fill(entry) {
    const { node, task } = entry;
    const from = node.offsetHeight;
    const body = [];
    if (entry.step === 'ask') {
      body.push(element('p', 'done-card-title', 'Задача выполнена?'), element('p', 'done-card-text', `«${task.title}» — по сообщениям похоже, что готово.`));
      const actions = element('div', 'done-card-actions');
      actions.append(button('primary', 'Да, готово', () => { cards.delete(task.id); close(task); }), button('link-button', 'Ещё нет', () => save(task, { op: 'update', proposed: null })));
      body.push(actions);
    } else {
      const keys = task.report?.missing?.length ? task.report.missing : reportKeys(task, tasks);
      body.push(element('p', 'done-card-title', 'Отчёт по задаче'));
      const form = element('form', 'done-card-form');
      for (const key of keys) {
        const field = tasks.report_fields?.[key];
        if (!field) continue;
        const label = element('label', 'done-card-field');
        const input = Object.assign(document.createElement('input'), { name: key, ...INPUT[field.type] });
        label.append(element('span', '', field.title), input);
        form.append(label);
      }
      if (keys.some((key) => tasks.report_fields?.[key]?.type === 'money')) {
        const label = element('label', 'done-card-field');
        const select = Object.assign(document.createElement('select'), { name: 'currency' });
        for (const currency of tasks.currencies ?? ['PLN']) select.append(Object.assign(document.createElement('option'), { value: currency, textContent: currency }));
        label.append(element('span', '', 'Валюта'), select);
        form.append(label);
      }
      const finish = () => {
        const values = Object.fromEntries(new FormData(form));
        const result = buildReport(keys, values, tasks.report_fields ?? {}, values.currency ?? tasks.currencies?.[0] ?? 'PLN');
        if (result.error) { notify(result.error); return; }
        const { missing: _old, ...filled } = task.report ?? {};
        save(task, { op: 'update', status: 'done', proposed: null, report: { ...filled, ...result.report } });
        cards.delete(task.id);
        onChange();
      };
      form.onsubmit = (event) => { event.preventDefault(); finish(); };
      const actions = element('div', 'done-card-actions');
      actions.append(button('primary', 'Сохранить', finish), button('link-button', 'Позже', () => { cards.delete(task.id); onChange(); }));
      form.append(actions);
      body.push(form, element('p', 'done-card-text', 'Пустое останется в вечерней сводке.'));
    }
    node.replaceChildren(...body);
    if (node.isConnected) play(node, [{ height: `${from}px`, overflow: 'hidden' }, { height: `${node.offsetHeight}px`, overflow: 'hidden' }]);
  }

  function create(task, step, manual) {
    const entry = { node: element('section', 'done-card'), step, task, manual };
    entry.node.setAttribute('aria-label', step === 'ask' ? `Задача выполнена? ${task.title}` : `Отчёт по задаче ${task.title}`);
    cards.set(task.id, entry);
    fill(entry);
    return entry;
  }

  // The card for a task the triage proposes to close, or whose report the owner is filling, or null. The same
  // node across redraws keeps what was typed.
  function card(task) {
    let entry = cards.get(task.id);
    if (entry?.manual) { entry.task = task; return entry.node; }
    const open = ['inbox', 'todo', 'doing', 'waiting', 'review', 'deferred'].includes(task.status);
    if (!open || task.proposed !== 'done') { cards.delete(task.id); return null; }
    entry ??= create(task, 'ask', false);
    entry.task = task;
    return entry.node;
  }

  // «Заполнить отчёт»: the report fields of a task (closed or closing).
  function start(task) {
    cards.delete(task.id);
    create(task, 'fields', true);
    onChange();
    cards.get(task.id)?.node.querySelector('input')?.focus({ preventScroll: true });
  }

  return { card, start };
}
