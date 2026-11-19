// «Контрагент» in task details (contacts design §6): the task's counterparty (a tap opens its card, «Сменить»), or
// «Кто контрагент?» — the triage's options, «+ Создать «…»» by its hint, «+ Новый» (an organization or an address,
// a side). Once chosen, the task's author can be linked to it with a job title. Pure helpers are tested in node.
import { personOf } from './contacts.js';
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

// The triage's options (active only) and its name for a new one (none when it names a known one).
export function counterpartyChoices(task, counterparties) {
  const byId = new Map(counterparties.filter((item) => item.status === 'active').map((item) => [item.id, item]));
  const options = (task.counterparty_options ?? []).map((id) => byId.get(id)).filter(Boolean);
  const hint = task.counterparty_hint?.trim() || null;
  const known = hint && counterparties.some((item) => item.title.toLowerCase() === hint.toLowerCase());
  return { options, hint: known ? null : hint };
}

// The change that creates a counterparty from the form, or null without a name. An address is its own title.
export function newCounterparty({ kind, title, side }) {
  const name = String(title ?? '').trim().slice(0, 120); // the contract's limit
  if (!name) return null;
  return { op: 'create', kind, title: name, ...(kind === 'address' ? { address: name } : {}), side: side ?? null };
}

const SIDES = [['pl', 'PL'], ['by', 'BY'], [null, 'не знаю']];

// ctx: { counterparties, people, save(change) — the task, saveCounterparty(id, change), savePerson(id, change), onOpen(id) }
export function counterpartyLine(task, ctx) {
  const box = element('div', 'details-counterparty');
  const choice = element('div', 'chips');
  const current = task.counterparty ? ctx.counterparties.find((item) => item.id === task.counterparty) : null;
  const author = task.roles?.author ? personOf(task.roles.author, ctx.people ?? []) : null;

  // After a choice: offer to link the author with a job title (an address — «живёт»).
  const offerLink = (counterparty) => {
    if (!author || author.roles.some((role) => role.counterparty === counterparty.id)) return;
    holding(choice);
    const field = Object.assign(document.createElement('input'), { className: 'details-input', value: counterparty.kind === 'address' ? 'живёт' : '', placeholder: 'должность' });
    field.setAttribute('aria-label', 'Должность');
    choice.replaceChildren(element('span', 'picker-section', `Связать ${author.name} как`), field,
      button('chip suggest', 'Связать', () => { holding(choice, false); ctx.savePerson(author.id, { op: 'update', roles: [...author.roles, { counterparty: counterparty.id, title: field.value.trim().slice(0, 60) }] }); choice.replaceChildren(); }),
      button('chip suggest', 'Не надо', () => { holding(choice, false); choice.replaceChildren(); }));
  };
  const choose = (counterparty) => {
    ctx.save({ op: 'update', counterparty: counterparty.id, counterparty_options: [], counterparty_hint: null });
    offerLink(counterparty);
  };
  const create = async (form) => {
    const change = newCounterparty(form);
    if (!change) return;
    const id = crypto.randomUUID();
    await ctx.saveCounterparty(id, change);
    choose({ id, kind: change.kind, title: change.title });
  };
  // «+ Новый»: kind, name or address, side; «Создать» waits for a name.
  const newForm = (title = '') => {
    holding(choice);
    let kind = 'org';
    let side = null;
    const field = Object.assign(document.createElement('input'), { className: 'details-input', value: title, placeholder: 'Название' });
    field.setAttribute('aria-label', 'Название или адрес');
    const go = button('chip on', 'Создать', () => { if (go.disabled) return; go.disabled = true; holding(choice, false); void create({ kind, title: field.value, side }); });
    const sync = () => { go.disabled = !newCounterparty({ kind, title: field.value, side }); };
    field.oninput = sync;
    const kinds = element('div', 'chips');
    const sides = element('div', 'chips');
    const toggle = (row, items, pick) => row.replaceChildren(...items.map(([value, label, on]) => button(`chip ${on ? 'on' : 'suggest'}`, label, () => pick(value))));
    const drawKinds = () => toggle(kinds, [['org', 'Организация', kind === 'org'], ['address', 'Адрес', kind === 'address']], (value) => { kind = value; field.placeholder = value === 'address' ? 'Улица, дом, город' : 'Название'; drawKinds(); });
    const drawSides = () => toggle(sides, SIDES.map(([value, label]) => [value, label, side === value]), (value) => { side = value; drawSides(); });
    drawKinds(); drawSides(); sync();
    choice.replaceChildren(kinds, field, sides, go);
    field.focus();
  };
  const picker = () => {
    holding(choice);
    const active = ctx.counterparties.filter((item) => item.status === 'active').sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    choice.replaceChildren(...active.map((item) => button(`chip ${item.id === task.counterparty ? 'on' : 'suggest'}`, item.title, () => { holding(choice, false); choose(item); })),
      button('chip suggest', '+ Новый', () => newForm()));
  };

  // `ctx.picking` — the participants' counterparty tile asks to change it: the choice right away.
  if (current && ctx.picking) { picker(); box.append(choice); return box; }
  if (current) {
    const line = element('div', 'details-counterparty-line');
    line.append(button('link-button', `◆ ${current.title}${current.status === 'archived' ? ' (в архиве)' : ''}`, () => ctx.onOpen?.(current.id), 'Карточка контрагента'),
      button('link-button muted', 'Сменить', picker));
    box.append(element('p', 'picker-section', 'Контрагент'), line, choice);
    return box;
  }
  const { options, hint } = counterpartyChoices(task, ctx.counterparties);
  const ask = element('div', 'chips counterparty-ask');
  ask.append(element('span', 'picker-section', 'Кто контрагент?'),
    ...options.map((item) => button('chip suggest', item.title, () => choose(item))),
    ...(hint ? [button('chip suggest', `+ Создать «${hint}»`, () => newForm(hint))] : []),
    button('chip suggest', '+ Новый', () => newForm()),
    ...(ctx.counterparties.some((item) => item.status === 'active') ? [button('link-button muted', 'Все…', picker)] : []));
  box.append(ask, choice);
  return box;
}
