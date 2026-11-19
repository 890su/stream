// People and counterparties as folds of the journal (contacts design §3): `contact_change` → people,
// `counterparty_change` → counterparties. A person's points are the parties the correspondence knows them by:
// `tel:+<digits>` from phones, `tg:<id>` from numeric Telegram ids. Pure — tested in node; the server folds the same
// way (src/contacts/fold.ts).
import { phoneNumber } from './parties.js';

const order = (a, b) => a.ts.localeCompare(b.ts) || (a.received_at ?? '').localeCompare(b.received_at ?? '');
const LISTS = ['phones', 'emails', 'telegram', 'addresses'];

// The parties of a person: phones in one form, numeric Telegram ids; no duplicates.
export function pointsOf(person) {
  const points = [
    ...person.phones.map(phoneNumber).filter((number) => number.replace('+', '').length >= 5).map((number) => `tel:${number}`),
    ...person.telegram.map((item) => String(item).trim()).filter((item) => /^\d+$/.test(item)).map((id) => `tg:${id}`),
  ];
  return [...new Set(points)];
}

export function foldPeople(events) {
  const people = new Map();
  for (const event of events.filter((item) => item.kind === 'contact_change').sort(order)) {
    const id = event.payload.ref.id;
    const change = event.payload.data.contact;
    let person = people.get(id);
    if (!person) {
      if (change.op !== 'create') continue;
      person = { id, name: change.name, phones: [], emails: [], telegram: [], addresses: [], note: '', status: 'active', roles: [], points: [], createdAt: event.ts };
      people.set(id, person);
    }
    for (const key of ['name', 'note', 'status', 'roles', ...LISTS]) if (change[key] !== undefined) person[key] = change[key];
    person.points = pointsOf(person);
  }
  return [...people.values()];
}

export function foldCounterparties(events) {
  const counterparties = new Map();
  for (const event of events.filter((item) => item.kind === 'counterparty_change').sort(order)) {
    const id = event.payload.ref.id;
    const change = event.payload.data.counterparty;
    let counterparty = counterparties.get(id);
    if (!counterparty) {
      if (change.op !== 'create') continue;
      counterparty = { id, kind: change.kind ?? 'org', title: change.title, address: '', side: null, taxId: '', status: 'active' };
      counterparties.set(id, counterparty);
    }
    for (const key of ['kind', 'title', 'address', 'side', 'status']) if (change[key] !== undefined) counterparty[key] = change[key];
    if (change.tax_id !== undefined) counterparty.taxId = change.tax_id;
  }
  return [...counterparties.values()];
}

// The active person a party belongs to; two with the same point — the first one made.
export function personOf(party, people) {
  return people.filter((person) => person.status !== 'deleted' && person.points.includes(party))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}

// The active people of a counterparty with their job titles.
export function peopleOf(counterpartyId, people) {
  return people.filter((person) => person.status !== 'deleted')
    .flatMap((person) => person.roles.filter((role) => role.counterparty === counterpartyId).map((role) => ({ person, title: role.title })));
}

// Puts the counterparty's title on tasks for rows (`task.counterpartyTitle`); in place, returns tasks.
export function markCounterparties(tasks, counterparties) {
  const byId = new Map(counterparties.map((item) => [item.id, item.title]));
  for (const task of tasks) task.counterpartyTitle = (task.counterparty && byId.get(task.counterparty)) || null;
  return tasks;
}
