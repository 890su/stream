// Parties and task roles (CONCEPT.md, P14); mirrors src/tasks/parties.ts — keep the two in step.
export const PARTY_PATTERN = /^(?:me|ai|system|tg:\d+|tel:\+\d+|group:tg:-?\d+|name:.+)$/u;
export const ROLE_KEYS = ['author', 'responsible', 'executors', 'controller', 'watchers', 'counterparty'];
export const PARTY_LABELS = { me: 'Я', ai: 'ИИ', system: 'Система' };

export function isParty(value) {
  return typeof value === 'string' && PARTY_PATTERN.test(value);
}

// A journal author as a party: the owner is `me`; one Telegram user is one party across both accounts.
export function partyOf(author) {
  if (author === 'me') return 'me';
  const telegram = /^contact:tg:[^:]+:(\d+)$/.exec(author);
  if (telegram) return `tg:${telegram[1]}`;
  return isParty(author) ? author : `name:${author}`;
}
