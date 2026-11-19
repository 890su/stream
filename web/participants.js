// «Участники» in the task card: each party once with its roles (CONCEPT.md §2.8); a tap on a participant shows every
// role to switch on or off and «Убрать»; «+ Участник» offers me, the people of the task's conversations, the
// directory and «Другой…», then the roles. A single role (author, responsible, controller) moves to the new holder;
// executors and watchers are lists. Pure helpers are tested in node.
import { partyName } from './parties.js';
import { delegateOptions } from './taskactions.js';
import { personForm } from './taskbar.js';
import { holding } from './holdrender.js';

export const ROLE_TITLES = { executors: 'Исполнитель', responsible: 'Ответственный', controller: 'Контролёр', author: 'Постановщик', watchers: 'Наблюдатель' };
const ORDER = ['author', 'responsible', 'executors', 'controller', 'watchers'];
const LISTS = new Set(['executors', 'watchers']);

// [{ party, roles }]: every party with a role, me first, then in the order roles name them.
export function participants(task) {
  const byParty = new Map();
  for (const role of ORDER) {
    for (const party of [task.roles?.[role]].flat().filter(Boolean)) {
      if (!byParty.has(party)) byParty.set(party, []);
      byParty.get(party).push(role);
    }
  }
  return [...byParty.entries()].map(([party, roles]) => ({ party, roles }))
    .sort((a, b) => Number(b.party === 'me') - Number(a.party === 'me'));
}

// The roles change that switches `role` for `party`.
export function toggleRole(roles, party, role) {
  if (LISTS.has(role)) {
    const list = roles?.[role] ?? [];
    return { [role]: list.includes(party) ? list.filter((item) => item !== party) : [...list, party] };
  }
  return { [role]: roles?.[role] === party ? null : party };
}

// The roles change that takes every role away from `party`.
export function removeParticipant(roles, party) {
  const change = {};
  for (const role of ORDER) {
    if (LISTS.has(role) && (roles?.[role] ?? []).includes(party)) change[role] = roles[role].filter((item) => item !== party);
    else if (!LISTS.has(role) && roles?.[role] === party) change[role] = null;
  }
  return change;
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

// Open participant rows survive redraws (each role tap redraws the card): `<task id>|<party>`.
const openRows = new Set();

// ctx: { views (the task's messages), people (the directory), save(change) }
export function participantsBlock(task, { views = [], people = [], save }) {
  const box = element('div', 'card-people');
  const add = element('div', 'chips card-people-add'); // «+ Участник»: who, then the roles
  const nameOf = (party) => people.find((person) => person.status !== 'deleted' && person.points.includes(party))?.name ?? partyName(party, views);
  // A saved change redraws the card: release the «+ Участник» hold first, open rows come back from `openRows`.
  const setRoles = (change) => { holding(add, false); save({ op: 'update', roles: change }); };
  const roleChips = (party, has) => ORDER.map((role) => {
    const on = has.includes(role);
    const chip = button(`chip ${on ? 'on' : 'suggest'}`, ROLE_TITLES[role], () => setRoles(toggleRole(task.roles, party, role)));
    chip.setAttribute('aria-pressed', String(on));
    return chip;
  });

  for (const { party, roles } of participants(task)) {
    const key = `${task.id}|${party}`;
    const row = element('div', `card-person${openRows.has(key) ? ' open' : ''}`);
    const head = button('card-person-head', '', () => {
      const open = row.classList.toggle('open');
      if (open) openRows.add(key); else openRows.delete(key);
      edit.hidden = !open;
    }, `${nameOf(party)}: роли`);
    head.append(element('span', 'card-person-name', nameOf(party)), element('span', 'card-person-roles', roles.map((role) => ROLE_TITLES[role]).join(', ')));
    const edit = element('div', 'chips card-person-edit');
    edit.hidden = !openRows.has(key);
    edit.append(...roleChips(party, roles), button('chip suggest muted', 'Убрать', () => setRoles(removeParticipant(task.roles, party))));
    row.append(head, edit);
    box.append(row);
  }


  const pickRoles = (party) => {
    holding(add);
    add.replaceChildren(element('span', 'picker-section', `${nameOf(party)} —`),
      ...ORDER.map((role) => button('chip suggest', ROLE_TITLES[role], () => setRoles(toggleRole(task.roles, party, role)))),
      button('chip suggest muted', 'Отмена', () => { holding(add, false); reset(); }));
  };
  const reset = () => add.replaceChildren(button('chip suggest', '+ Участник', choose));
  function choose() {
    holding(add);
    const known = new Set(participants(task).map((item) => item.party));
    const candidates = [{ party: 'me', name: 'Я' }, ...delegateOptions(views),
      ...people.filter((person) => person.status !== 'deleted' && person.points.length).map((person) => ({ party: person.points[0], name: person.name }))]
      .filter((item, index, list) => !known.has(item.party) && list.findIndex((other) => other.party === item.party) === index).slice(0, 12);
    add.replaceChildren(...candidates.map(({ party, name }) => button('chip suggest', name, () => pickRoles(party))),
      button('chip suggest', 'Другой…', () => add.replaceChildren(personForm(pickRoles))),
      button('chip suggest muted', 'Отмена', () => { holding(add, false); reset(); }));
  }
  reset();
  box.append(add);
  return box;
}
