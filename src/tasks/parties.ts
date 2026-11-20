// Parties and task roles (CONCEPT.md, P14): a party is a short string naming who takes part in a task.
// Pure helpers shared by the contract check and the triage; a client copy lives in web/parties.js.
// A party is at most 120 characters; a `name:` party starts with a non-space (same rule in contracts/event.schema.json).
export const PARTY_PATTERN = /^(?=.{1,120}$)(?:me|ai|system|tg:\d+|tel:\+\d+|group:tg:-?\d+|name:\S.*)$/u;
export const ROLE_KEYS = ['author', 'responsible', 'executors', 'controller', 'watchers', 'counterparty', 'members'] as const;
// Roles held by many parties; the others by one or none. `members` — plain participants, without a role (2026-11-19).
export const LIST_ROLES: ReadonlySet<string> = new Set(['executors', 'watchers', 'members']);

export function isParty(value: unknown): value is string {
  return typeof value === 'string' && PARTY_PATTERN.test(value);
}

// A journal author as a party: the owner is `me`; one Telegram user is one party across both accounts.
export function partyOf(author: string): string {
  if (author === 'me') return 'me';
  const telegram = /^contact:tg:[^:]+:(\d+)$/.exec(author);
  if (telegram) return `tg:${telegram[1]}`;
  // A Viber or WhatsApp sender: the phone when the messenger shows it (one person with their calls and SMS), else
  // the chat's name.
  const messenger = /^contact:(?:viber|whatsapp):(.+)$/.exec(author);
  if (messenger) return /^\+\d+$/.test(messenger[1]!) ? `tel:${messenger[1]}` : `name:${messenger[1]!.trim().slice(0, 115)}`;
  return isParty(author) ? author : `name:${author}`;
}

// A phone number in one form: digits only, a leading `+` kept, a leading `00` read as `+`.
export function phoneNumber(raw: unknown): string {
  const text = String(raw ?? '').trim();
  return `${text.startsWith('+') ? '+' : ''}${text.replace(/\D/g, '')}`.replace(/^00/, '+');
}

interface EventLike { author: string; payload?: { data?: Record<string, unknown> } }

// Who wrote an event as a party. The phone companion stores every call and SMS as `me`; an incoming one
// (in, missed, rejected) is the caller: `tel:+…`, a number without a country code or a name as `name:…`.
export function partyOfEvent(event: EventLike): string {
  const data = event.payload?.data ?? {};
  // Call and SMS data sit only on their own kinds (contracts/event.schema.json).
  const phone = (data.call ?? data.sms) as { direction?: string; number?: string; name?: string } | undefined;
  if (phone && ['in', 'missed', 'rejected'].includes(phone.direction ?? '')) {
    const number = phoneNumber(phone.number);
    if (/^\+\d+$/.test(number)) return `tel:${number}`;
    const name = (number || phone.name || '').trim().slice(0, 115);
    if (name) return `name:${name}`;
  }
  return partyOf(event.author);
}

// The controller a task gets by default: me, when I am responsible and hand the work to others, or when I
// asked someone else to be responsible. Otherwise none.
export function defaultController(roles: { author?: string | null; responsible?: string | null; executors?: string[] }): 'me' | null {
  const executors = roles.executors ?? [];
  if (roles.responsible === 'me' && executors.length && !executors.includes('me')) return 'me';
  if (roles.author === 'me' && roles.responsible && roles.responsible !== 'me') return 'me';
  return null;
}
