// People and counterparties as folds of the journal (contacts design §3), server side for the triage. The device
// folds the same way (web/contacts.js); test/contacts.test.ts checks both on the same events.
import type { JournalEvent } from '../contracts/validate.ts';
import { phoneNumber } from '../tasks/parties.ts';

export interface Role { counterparty: string; title: string }
export interface Person {
  id: string; name: string; phones: string[]; emails: string[]; telegram: string[]; addresses: string[]; note: string;
  status: 'active' | 'deleted'; roles: Role[]; points: string[]; createdAt: string;
}
export interface Counterparty { id: string; kind: 'org' | 'address'; title: string; address: string; side: 'pl' | 'by' | null; taxId: string; status: 'active' | 'archived' }

const order = (a: JournalEvent, b: JournalEvent) => a.ts.localeCompare(b.ts) || (a.received_at ?? '').localeCompare(b.received_at ?? '');
const LISTS = ['phones', 'emails', 'telegram', 'addresses'] as const;

export function pointsOf(person: Pick<Person, 'phones' | 'telegram'>): string[] {
  const points = [
    ...person.phones.map(phoneNumber).filter((number) => number.replace('+', '').length >= 5).map((number) => `tel:${number}`),
    ...person.telegram.map((item) => String(item).trim()).filter((item) => /^\d+$/.test(item)).map((id) => `tg:${id}`),
  ];
  return [...new Set(points)];
}

export function foldPeople(events: JournalEvent[]): Person[] {
  const people = new Map<string, Person>();
  for (const event of events.filter((item) => item.kind === 'contact_change').sort(order)) {
    const id = event.payload.ref!.id;
    const change = event.payload.data!.contact as Record<string, any>;
    let person = people.get(id);
    if (!person) {
      if (change.op !== 'create') continue;
      person = { id, name: change.name, phones: [], emails: [], telegram: [], addresses: [], note: '', status: 'active', roles: [], points: [], createdAt: event.ts };
      people.set(id, person);
    }
    for (const key of ['name', 'note', 'status', 'roles', ...LISTS] as const) if (change[key] !== undefined) (person as any)[key] = change[key];
    person.points = pointsOf(person);
  }
  return [...people.values()];
}

export function foldCounterparties(events: JournalEvent[]): Counterparty[] {
  const counterparties = new Map<string, Counterparty>();
  for (const event of events.filter((item) => item.kind === 'counterparty_change').sort(order)) {
    const id = event.payload.ref!.id;
    const change = event.payload.data!.counterparty as Record<string, any>;
    let counterparty = counterparties.get(id);
    if (!counterparty) {
      if (change.op !== 'create') continue;
      counterparty = { id, kind: change.kind ?? 'org', title: change.title, address: '', side: null, taxId: '', status: 'active' };
      counterparties.set(id, counterparty);
    }
    for (const key of ['kind', 'title', 'address', 'side', 'status'] as const) if (change[key] !== undefined) (counterparty as any)[key] = change[key];
    if (change.tax_id !== undefined) counterparty.taxId = change.tax_id;
  }
  return [...counterparties.values()];
}

export function personOf(party: string, people: Person[]): Person | null {
  return people.filter((person) => person.status !== 'deleted' && person.points.includes(party))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}

export function peopleOf(counterpartyId: string, people: Person[]): { person: Person; title: string }[] {
  return people.filter((person) => person.status !== 'deleted')
    .flatMap((person) => person.roles.filter((role) => role.counterparty === counterpartyId).map((role) => ({ person, title: role.title })));
}
