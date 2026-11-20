// «Участники» of the task card (owner's design, 2026-11-19): a cloud of tiles — 👤 · role · | · name · ×. The person
// icon opens the roles (Участник — no role, shown without a label; Постановщик, Контрагент, Исполнитель, then the
// rest); a tap on the name switches the participant off and on (an answer from the task does not go to a switched-off
// one); × takes them out. The directory's counterparty of the task is a tile too (◆ / ⌂). Up to four rows of tiles;
// more — the cloud widens and scrolls sideways. «+» without a label adds a participant (as Участник). The same tiles
// in one sideways line over the tags of an open conversation (`strip`, peoplerow.js): the conversation's task is
// edited, so a conversation and its task have one set of participants. Pure helpers are tested in node.
import { partyName, LIST_ROLES } from './parties.js';
import { delegateOptions } from './taskactions.js';
import { personForm } from './taskbar.js';
import { holding } from './holdrender.js';
import { counterpartyLine } from './counterpartyline.js';

export const ROLE_TITLES = { members: 'Участник', author: 'Постановщик', counterparty: 'Контрагент', executors: 'Исполнитель', responsible: 'Ответственный', controller: 'Контролёр', watchers: 'Наблюдатель' };
const ROLES = ['author', 'counterparty', 'executors', 'responsible', 'controller', 'watchers']; // the menu after «Участник»
const ALL = [...ROLES, 'members'];
const has = (roles, role, party) => (LIST_ROLES.has(role) ? (roles?.[role] ?? []).includes(party) : roles?.[role] === party);

// [{ party, roles, muted }]: every party with a role or plain (members), me first, then in the order roles name them.
export function participants(task) {
  const byParty = new Map();
  for (const role of ALL) {
    for (const party of [task.roles?.[role]].flat().filter(Boolean)) {
      if (!byParty.has(party)) byParty.set(party, []);
      if (role !== 'members') byParty.get(party).push(role);
    }
  }
  const muted = new Set(task.muted ?? []);
  return [...byParty.entries()].map(([party, roles]) => ({ party, roles, muted: muted.has(party) }))
    .sort((a, b) => Number(b.party === 'me') - Number(a.party === 'me'));
}

// The roles change that switches `role` for `party`. Nobody drops out with it: the party, and the former holder of a
// single role, stay as plain participants. `members` — «Участник»: every role of the party off.
export function toggleRole(roles, party, role) {
  const members = roles?.members ?? [];
  const keep = (list, ...parties) => [...new Set([...list, ...parties.filter(Boolean)])];
  if (role === 'members') return { ...withoutRoles(roles, party), members: keep(members, party) };
  if (LIST_ROLES.has(role)) {
    const list = roles?.[role] ?? [];
    return { [role]: list.includes(party) ? list.filter((item) => item !== party) : [...list, party], members: keep(members, party) };
  }
  const before = roles?.[role] ?? null;
  return { [role]: before === party ? null : party, members: keep(members, party, before !== party ? before : null) };
}

// Every role of `party` off (members kept as they are).
function withoutRoles(roles, party) {
  const change = {};
  for (const role of ROLES) {
    if (!has(roles, role, party)) continue;
    change[role] = LIST_ROLES.has(role) ? roles[role].filter((item) => item !== party) : null;
  }
  return change;
}

// The roles change that takes `party` out of the task.
export function removeParticipant(roles, party) {
  const change = withoutRoles(roles, party);
  if ((roles?.members ?? []).includes(party)) change.members = roles.members.filter((item) => item !== party);
  return change;
}

// The muted list after a tap on the name.
export const toggleMuted = (task, party) => ((task.muted ?? []).includes(party) ? task.muted.filter((item) => item !== party) : [...(task.muted ?? []), party]);

// A personal chat of a switched-off participant gets no answer from the task or the conversation by default.
export const answerable = (conversation, muted = []) => Boolean(conversation.reply) && (conversation.reply.group || !muted.includes(`tg:${conversation.reply.chat_id}`));

// The tile's label: «Участник» is not shown; several roles are joined.
export const roleLabel = (roles) => roles.map((role) => ROLE_TITLES[role]).join(', ');

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
const PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/></svg>';

// A tile: icon (a button), role | (when there is one), name (a button), × — on the chosen tile of the card 📣 (the
// conversation under the line is with this one).
function tile({ icon, iconLabel, onIcon, role, name, nameLabel, onName, off = false, onRemove = null, removeLabel, selected = false }) {
  const node = element('span', `person-tile${role ? ' with-role' : ''}${off ? ' off' : ''}${selected ? ' selected' : ''}`);
  const glyph = button('person-tile-icon', '', onIcon, iconLabel);
  if (icon) glyph.textContent = icon; else glyph.innerHTML = PERSON;
  node.append(glyph);
  if (role) node.append(element('span', 'person-tile-role', role), element('span', 'person-tile-divider'));
  const label = button('person-tile-name', name, onName, nameLabel);
  if (off !== null) label.setAttribute('aria-pressed', String(!off));
  node.append(label);
  if (selected) node.append(element('span', 'person-tile-speaker', '📣'));
  else if (onRemove) node.append(button('person-tile-remove', '×', onRemove, removeLabel));
  return node;
}

// Up to four rows of tiles; more — the inner box widens until they fit in four rows, and the cloud scrolls sideways.
const ROWS = 4;
function fitRows(cloud, inner) {
  requestAnimationFrame(() => {
    if (!cloud.isConnected) return;
    inner.style.width = '';
    const first = inner.firstElementChild;
    if (!first) return;
    const gap = parseFloat(getComputedStyle(inner).rowGap) || 0;
    const max = ROWS * first.offsetHeight + (ROWS - 1) * gap + 1;
    let width = cloud.clientWidth;
    while (inner.scrollHeight > max && width < 6000) { width += 80; inner.style.width = `${width}px`; }
    cloud.classList.toggle('wide', width > cloud.clientWidth);
  });
}

// Open menus survive redraws (each change redraws the card): `<task id>|<party>` or `<task id>|+`.
let openMenu = null;

// ctx: { views (the task's messages), people, counterparties (the directory), save(change), savePerson, saveCounterparty,
//   onOpenCounterparty(id), strip (one sideways line, no counterparty question), readOnly(text) — no task: the tiles
//   only show who is there, a tap says `text`; select — the task card's line: { order (parties, the chosen first),
//   selected, onSelect(party) } — a tap on the name chooses whose conversation shows; «Не отвечать» moves to the roles }
export function participantsBlock(task, ctx) {
  const { views = [], people = [], save } = ctx;
  const box = element('div', `card-people${ctx.strip ? ' strip' : ''}`);
  const menu = element('div', 'chips card-people-menu');
  const nameOf = ctx.nameOf ?? ((party) => people.find((person) => person.status !== 'deleted' && person.points.includes(party))?.name ?? partyName(party, views));
  const setRoles = (change) => { openMenu = null; holding(menu, false); save({ op: 'update', roles: change }); };
  const show = (key, nodes) => {
    openMenu = nodes ? key : null;
    holding(menu, Boolean(nodes));
    menu.replaceChildren(...(nodes ?? []));
  };

  // The roles of one participant: «Участник» first, then the roles; the ones held are on.
  const muteChip = (party) => {
    const off = (task.muted ?? []).includes(party);
    return button('chip suggest', off ? 'Отвечать ему' : 'Не отвечать ему', () => { show(null); save({ op: 'update', muted: toggleMuted(task, party) }); });
  };
  const rolesMenu = (party, held) => [element('span', 'picker-section', nameOf(party)), ...(ctx.select && party !== 'me' ? [muteChip(party)] : []),
    button(`chip ${held.length ? 'suggest' : 'on'}`, ROLE_TITLES.members, () => setRoles(toggleRole(task.roles, party, 'members'))),
    ...ROLES.map((role) => {
      const chip = button(`chip ${held.includes(role) ? 'on' : 'suggest'}`, ROLE_TITLES[role], () => setRoles(toggleRole(task.roles, party, role)));
      chip.setAttribute('aria-pressed', String(held.includes(role)));
      return chip;
    }),
    button('chip suggest muted', 'Закрыть', () => show(null))];

  const cloud = element('div', 'people-cloud');
  const inner = element('div', 'people-cloud-inner');
  cloud.append(inner);
  const listed = participants(task);
  const ordered = ctx.select ? ctx.select.order.map((party) => listed.find((item) => item.party === party) ?? (party === 'me' ? { party, roles: [], muted: false, notes: true } : null)).filter(Boolean) : listed;
  for (const { party, roles, muted, notes } of ordered) {
    const key = `${task.id}|${party}`;
    const name = nameOf(party);
    if (notes) {
      const open = () => ctx.select.onSelect(party);
      inner.append(tile({ icon: '✎', iconLabel: 'Заметки задачи', name, nameLabel: 'Заметки задачи', off: null, selected: ctx.select.selected === party, onIcon: open, onName: open }));
      continue;
    }
    if (ctx.readOnly) { inner.append(tile({ role: '', name, off: null, iconLabel: name, nameLabel: name, onIcon: () => ctx.readOnly(), onName: () => ctx.readOnly() })); continue; }
    const selected = ctx.select?.selected === party;
    inner.append(tile({ role: roleLabel(roles), name, off: muted, selected,
      iconLabel: `${name}: роль`, onIcon: () => (openMenu === key ? show(null) : show(key, rolesMenu(party, roles))),
      nameLabel: ctx.select ? (selected ? `${name}: беседа открыта` : `Беседа с ${name}`) : muted ? `${name}: отключён, включить` : `${name}: включён, отключить`,
      onName: ctx.select ? () => ctx.select.onSelect(party) : () => save({ op: 'update', muted: toggleMuted(task, party) }),
      removeLabel: `Убрать ${name}`, onRemove: () => save({ op: 'update', roles: removeParticipant(task.roles, party), ...(muted ? { muted: toggleMuted(task, party) } : {}) }) }));
  }

  // The counterparty of the directory: ◆ an organization, ⌂ an address; the icon changes it, the name opens its card.
  const counterparty = task.counterparty ? (ctx.counterparties ?? []).find((item) => item.id === task.counterparty) : null;
  const directory = { people, counterparties: ctx.counterparties ?? [], save, savePerson: ctx.savePerson, saveCounterparty: ctx.saveCounterparty, onOpen: ctx.onOpenCounterparty };
  if (counterparty) {
    const key = `${task.id}|counterparty`;
    const change = () => [counterpartyLine(task, { ...directory, picking: true }), button('chip suggest muted', 'Закрыть', () => show(null))];
    inner.append(tile({ icon: counterparty.kind === 'address' ? '⌂' : '◆', iconLabel: 'Сменить контрагента', role: 'Контрагент',
      onIcon: () => (openMenu === key ? show(null) : show(key, change())), off: null,
      name: `${counterparty.title}${counterparty.status === 'archived' ? ' (в архиве)' : ''}`, nameLabel: 'Карточка контрагента', onName: () => ctx.onOpenCounterparty?.(counterparty.id),
      removeLabel: 'Убрать контрагента', onRemove: () => save({ op: 'update', counterparty: null }) }));
  }

  // «+»: me, the people of the task's conversations, the directory, «Другой…» — added as Участник.
  const addKey = `${task.id}|+`;
  const addMenu = () => {
    const known = new Set(participants(task).map((item) => item.party));
    const candidates = [{ party: 'me', name: 'Я' }, ...delegateOptions(views),
      ...people.filter((person) => person.status !== 'deleted' && person.points.length).map((person) => ({ party: person.points[0], name: person.name }))]
      .filter((item, index, list) => !known.has(item.party) && list.findIndex((other) => other.party === item.party) === index).slice(0, 12);
    const add = (party) => setRoles({ members: [...new Set([...(task.roles?.members ?? []), party])] });
    return [element('span', 'picker-section', 'Добавить'), ...candidates.map(({ party, name }) => button('chip suggest', name, () => add(party))),
      button('chip suggest', 'Другой…', () => show(addKey, [personForm(add)])),
      button('chip suggest muted', 'Закрыть', () => show(null))];
  };
  const plus = button('people-add', '+', () => (openMenu === addKey ? show(null) : show(addKey, addMenu())), 'Добавить участника');
  const row = element('div', 'people-row');
  row.append(cloud);
  if (!ctx.readOnly) row.append(plus);
  box.append(row, menu);
  if (!inner.childElementCount) cloud.append(element('p', 'drawer-empty', 'Участников нет'));

  // No counterparty yet: the triage's question or a choice, under the cloud.
  if (!counterparty && !task.filed && ctx.counterparties && !ctx.strip) box.append(counterpartyLine(task, directory));

  // A menu open before the redraw comes back.
  if (openMenu === addKey) show(addKey, addMenu());
  else if (openMenu?.startsWith(`${task.id}|`)) {
    const party = openMenu.slice(task.id.length + 1);
    const found = participants(task).find((item) => item.party === party);
    if (party === 'counterparty' && counterparty) show(openMenu, [counterpartyLine(task, { ...directory, picking: true }), button('chip suggest muted', 'Закрыть', () => show(null))]);
    else if (found) show(openMenu, rolesMenu(party, found.roles));
    else openMenu = null;
  }
  if (!ctx.strip) fitRows(cloud, inner);
  return box;
}
