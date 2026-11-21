// The address book in the left panel (docs/plans/2026-11-21-workspace-redesign-design.md): the directory's people in
// alphabetical order with a search by name or number; each knows its latest conversation over any of its points.
// A tap opens that conversation in the centre and the person's card on the right (drawer.js). contactList is pure.
import { conversationParty } from './cardtalk.js';

const digits = (text) => String(text).replace(/\D/g, '');

// [{ id, name, phone, key, last }] — `key` / `last`: the latest conversation of the person, or null.
export function contactList(people, conversations, query = '') {
  const wanted = query.trim().toLowerCase();
  const number = digits(wanted);
  const latest = new Map(); // point -> the newest conversation for it
  for (const item of conversations) {
    const party = conversationParty(item) ?? item.key;
    const known = latest.get(party);
    if (!known || String(item.last ?? '') > String(known.last ?? '')) latest.set(party, item);
  }
  return people
    .filter((person) => person.status !== 'deleted')
    .filter((person) => !wanted || person.name.toLowerCase().includes(wanted)
      || (number.length >= 3 && person.points.some((point) => digits(point).includes(number))))
    .map((person) => {
      const chat = person.points.map((point) => latest.get(point)).filter(Boolean)
        .sort((a, b) => String(b.last ?? '').localeCompare(String(a.last ?? '')))[0] ?? null;
      const phone = person.points.find((point) => point.startsWith('tel:'))?.slice(4) ?? null;
      return { id: person.id, name: person.name, phone, key: chat?.key ?? null, last: chat?.last ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The search field and the rows; `onOpen(contact)` on a tap. `state` keeps the query between redraws.
export function contactsNodes({ people, conversations, state, onOpen }) {
  const search = element('input', 'view-search contacts-search');
  search.type = 'search';
  search.placeholder = 'Имя или номер';
  search.setAttribute('aria-label', 'Найти контакт по имени или номеру');
  search.value = state.query ?? '';
  const rows = element('div', 'contacts-rows');
  const draw = () => {
    const list = contactList(people, conversations, search.value);
    rows.replaceChildren(...(list.length ? list.map((contact) => {
      const row = element('button', 'drawer-contact contact-row');
      row.type = 'button';
      row.append(element('span', 'drawer-title', contact.name), element('span', 'drawer-count', contact.phone ?? ''));
      row.onclick = () => onOpen(contact);
      return row;
    }) : [element('p', 'drawer-empty', search.value.trim() ? 'Контакт не найден' : 'В справочнике пока нет контактов')]));
  };
  search.oninput = () => { state.query = search.value; draw(); };
  draw();
  return [search, rows];
}
