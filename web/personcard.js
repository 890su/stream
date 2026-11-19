// The person card in the right panel (contacts design §6): name, phones, e-mail, Telegram, addresses, a note — each
// edited in place and saved as a `contact_change` with the changed field; job titles at counterparties (a tap opens
// the counterparty); open tasks through the person's points. Pure helpers are tested in node.
import { ROLE_KEYS } from './parties.js';
import { isOpen } from './taskfold.js';
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

// A new person from a conversation: a Telegram chat gives its user id, a number gives the phone; own notes and split
// conversations are not a person.
export function personFromConversation(conversation) {
  const key = conversation?.key ?? '';
  if (key.startsWith('tg:')) return { name: conversation.title, phones: [], telegram: [key.slice(3)] };
  if (key.startsWith('tel:')) return { name: conversation.title, phones: [key.slice(4)], telegram: [] };
  return null;
}

// A list typed in one field: split by commas, semicolons and new lines; trimmed, no blanks or repeats.
export function splitList(text) {
  return [...new Set(String(text ?? '').split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))];
}

// Open tasks where one of the person's points has a role.
export function personTasks(person, tasks) {
  const points = new Set(person.points);
  return tasks.filter((task) => isOpen(task) && ROLE_KEYS.some((key) => [task.roles?.[key]].flat().some((party) => points.has(party))));
}

const FIELDS = [['phones', 'Телефоны'], ['emails', 'Почта'], ['telegram', 'Telegram (id)'], ['addresses', 'Адреса']];

// ctx: { counterparties, tasks, savePerson(id, change), onOpenCounterparty(id), onOpenTask(id) }
export function personCard(person, ctx) {
  const box = element('div', 'details-card');
  const save = (change) => ctx.savePerson(person.id, { op: 'update', ...change });
  // One field: shown as text, a tap turns it into an input; Enter or leaving it saves.
  const field = (label, value, onSave, { multiline = false } = {}) => {
    const row = element('div', 'card-field');
    const show = () => {
      holding(row, false);
      row.replaceChildren(element('span', 'picker-section', label), button('link-button card-value', value || '—', edit, `${label}: изменить`));
    };
    const edit = () => {
      holding(row);
      const input = Object.assign(document.createElement(multiline ? 'textarea' : 'input'), { className: 'details-input', value });
      const done = () => { const next = input.value.trim(); if (next !== value) onSave(next); show(); };
      input.onblur = done;
      input.onkeydown = (event) => { if (event.key === 'Enter' && !multiline) { event.preventDefault(); input.blur(); } };
      row.replaceChildren(element('span', 'picker-section', label), input);
      input.focus();
    };
    show();
    return row;
  };
  box.append(field('Имя', person.name, (name) => { if (name) save({ name: name.slice(0, 120) }); }));
  for (const [key, label] of FIELDS) box.append(field(label, person[key].join(', '), (text) => save({ [key]: splitList(text) }), { multiline: key === 'addresses' }));
  box.append(field('Заметка', person.note, (note) => save({ note: note.slice(0, 1000) }), { multiline: true }));

  const byId = new Map(ctx.counterparties.map((item) => [item.id, item]));
  const roles = person.roles.filter((role) => byId.has(role.counterparty));
  if (roles.length) {
    box.append(element('p', 'picker-section', 'Контрагенты'));
    for (const role of roles) box.append(button('link-button card-link', `◆ ${byId.get(role.counterparty).title}${role.title ? ` — ${role.title}` : ''}`, () => ctx.onOpenCounterparty(role.counterparty)));
  }
  const tasks = personTasks(person, ctx.tasks);
  if (tasks.length) {
    box.append(element('p', 'picker-section', 'Открытые задачи'));
    for (const task of tasks) box.append(button('link-button card-link', task.title, () => ctx.onOpenTask(task.id)));
  }
  if (person.status !== 'deleted') box.append(button('link-button muted', 'Удалить из справочника', () => save({ status: 'deleted' })));
  return box;
}
