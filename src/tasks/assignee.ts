// Who an assignment goes to (#поручить, docs/plans/2026-11-23-conversation-records-design.md «Метка — указание»): the
// AI may name the person instead of giving a party (`name:Алекс` or just «Алекс»). One person of the directory with
// that name and a conversation (a point: tel:, tg:) is that person; several are offered to the owner as answers to
// «Кому поручить?»; none leaves the name as it is. Pure.
import type { Person } from '../contacts/fold.ts';
import { personOf } from '../contacts/fold.ts';
import { isParty } from './parties.ts';

const norm = (text: string) => text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

// The directory's people with a conversation that the name fits: the whole name, else every word of it as a word of theirs.
export function peopleNamed(name: string, people: Person[]): Person[] {
  const wanted = norm(name.replace(/^name:/, ''));
  if (!wanted) return [];
  const live = people.filter((person) => person.status !== 'deleted' && person.points.length);
  const exact = live.filter((person) => norm(person.name) === wanted);
  if (exact.length) return exact;
  const words = wanted.split(' ');
  return live.filter((person) => { const own = norm(person.name).split(' '); return words.every((word) => own.includes(word)); });
}

// An executor as the AI gave it → the person's party when the name fits exactly one; a plain name becomes `name:…`.
export function resolveExecutor(party: string, people: Person[]): string {
  const raw = String(party ?? '').trim();
  if (isParty(raw) && !raw.startsWith('name:')) return raw;
  const name = raw.replace(/^name:/, '').trim();
  const found = peopleNamed(name, people);
  if (found.length === 1) return found[0]!.points[0]!;
  return name && isParty(`name:${name}`) ? `name:${name}` : raw;
}

// The known people an executor may mean (up to three): the person of a known party, or those a name fits.
export function candidatesFor(party: string, people: Person[]): { party: string; name: string }[] {
  const known = personOf(party, people);
  if (known) return [{ party, name: known.name }];
  if (!party.startsWith('name:')) return [];
  return peopleNamed(party, people).slice(0, 3).map((person) => ({ party: person.points[0]!, name: person.name }));
}
