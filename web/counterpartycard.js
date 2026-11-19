// The counterparty card in the right panel (contacts design §6): kind, name or address, side, its people with job
// titles (a tap opens the person), its open tasks, «В архив» / «Вернуть из архива». Edits are `counterparty_change`.
import { peopleOf } from './contacts.js';
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

const KINDS = { org: 'Организация', address: 'Адрес (частный клиент)' };
const SIDES = [['pl', 'PL'], ['by', 'BY'], [null, 'не знаю']];

// ctx: { people, tasks, saveCounterparty(id, change), onOpenPerson(id), onOpenTask(id) }
export function counterpartyCard(counterparty, ctx) {
  const box = element('div', 'details-card');
  const save = (change) => ctx.saveCounterparty(counterparty.id, { op: 'update', ...change });
  box.append(element('p', 'details-meta', `${KINDS[counterparty.kind] ?? counterparty.kind}${counterparty.status === 'archived' ? ' · в архиве' : ''}`));

  const name = element('div', 'card-field');
  const showName = () => {
    holding(name, false);
    name.replaceChildren(element('span', 'picker-section', counterparty.kind === 'address' ? 'Адрес' : 'Название'),
      button('link-button card-value', counterparty.title, () => {
        holding(name);
        const input = Object.assign(document.createElement('input'), { className: 'details-input', value: counterparty.title });
        input.onblur = () => {
          const next = input.value.trim().slice(0, 120);
          if (next && next !== counterparty.title) save({ title: next, ...(counterparty.kind === 'address' ? { address: next } : {}) });
          showName();
        };
        input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } };
        name.replaceChildren(input);
        input.focus();
      }, 'Изменить название'));
  };
  showName();
  const sides = element('div', 'chips');
  sides.append(element('span', 'picker-section', 'Сторона'),
    ...SIDES.map(([value, label]) => button(`chip ${counterparty.side === value ? 'on' : 'suggest'}`, label, () => save({ side: value }))));
  box.append(name, sides);

  const people = peopleOf(counterparty.id, ctx.people);
  box.append(element('p', 'picker-section', 'Люди'));
  if (!people.length) box.append(element('p', 'details-meta', 'Пока никого: людей связывает «Кто контрагент?» в задаче или карточка человека.'));
  for (const { person, title } of people) box.append(button('link-button card-link', `${person.name}${title ? ` — ${title}` : ''}`, () => ctx.onOpenPerson(person.id)));

  const tasks = ctx.tasks.filter((task) => task.counterparty === counterparty.id && isOpen(task));
  if (tasks.length) {
    box.append(element('p', 'picker-section', 'Открытые задачи'));
    for (const task of tasks) box.append(button('link-button card-link', task.title, () => ctx.onOpenTask(task.id)));
  }
  box.append(counterparty.status === 'archived'
    ? button('link-button', 'Вернуть из архива', () => save({ status: 'active' }))
    : button('link-button muted', 'В архив', () => save({ status: 'archived' })));
  return box;
}
