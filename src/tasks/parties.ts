// Parties and task roles (CONCEPT.md, P14): a party is a short string naming who takes part in a task.
// Pure helpers shared by the contract check and the triage; a client copy lives in web/parties.js.
export const PARTY_PATTERN = /^(?:me|ai|system|tg:\d+|tel:\+\d+|group:tg:-?\d+|name:.+)$/u;
export const ROLE_KEYS = ['author', 'responsible', 'executors', 'controller', 'watchers', 'counterparty'] as const;

export function isParty(value: unknown): value is string {
  return typeof value === 'string' && PARTY_PATTERN.test(value);
}

// A journal author as a party: the owner is `me`; one Telegram user is one party across both accounts.
export function partyOf(author: string): string {
  if (author === 'me') return 'me';
  const telegram = /^contact:tg:[^:]+:(\d+)$/.exec(author);
  if (telegram) return `tg:${telegram[1]}`;
  return isParty(author) ? author : `name:${author}`;
}
