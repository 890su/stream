// Parties and task roles (CONCEPT.md, P14); mirrors src/tasks/parties.ts — keep the two in step. Also a party's
// name in words (`partyName`), shared by task rows, plaques and details. Pure, no imports — tested in node.
// A party is at most 120 characters; a `name:` party starts with a non-space (same rule in contracts/event.schema.json).
export const PARTY_PATTERN = /^(?=.{1,120}$)(?:me|ai|system|tg:\d+|tel:\+\d+|group:tg:-?\d+|name:\S.*)$/u;
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

// A phone number in one form: digits only, a leading `+` kept, a leading `00` read as `+`.
export function phoneNumber(raw) {
  const text = String(raw ?? '').trim();
  return `${text.startsWith('+') ? '+' : ''}${text.replace(/\D/g, '')}`.replace(/^00/, '+');
}

// Call and SMS data sit only on their own kinds (contracts/event.schema.json).
const phoneOf = (event) => event?.payload?.data?.call ?? event?.payload?.data?.sms;

// Who wrote an event as a party. The phone companion stores every call and SMS as `me`; an incoming one
// (in, missed, rejected) is the caller: `tel:+…`, a number without a country code or a name as `name:…`.
export function partyOfEvent(event) {
  const phone = phoneOf(event);
  if (phone && ['in', 'missed', 'rejected'].includes(phone.direction)) {
    const number = phoneNumber(phone.number);
    if (/^\+\d+$/.test(number)) return `tel:${number}`;
    const name = (number || phone.name || '').trim().slice(0, 115);
    if (name) return `name:${name}`;
  }
  return partyOf(event.author);
}

// The controller a task gets by default: me, when I am responsible and hand the work to others, or when I
// asked someone else to be responsible. Otherwise none.
export function defaultController(roles) {
  const executors = roles.executors ?? [];
  if (roles.responsible === 'me' && executors.length && !executors.includes('me')) return 'me';
  if (roles.author === 'me' && roles.responsible && roles.responsible !== 'me') return 'me';
  return null;
}

// A party in words: Я / ИИ / Система, a name, else a name found in `views` (the messages around it: a phone
// contact, a private chat's title, a sender's name, a group's title), else the number or the party as it is.
export function partyName(party, views = []) {
  if (!party) return '';
  if (PARTY_LABELS[party]) return PARTY_LABELS[party];
  if (party.startsWith('name:')) return party.slice(5);
  if (party.startsWith('tel:')) {
    const number = party.slice(4);
    const known = views.map((view) => phoneOf(view.event)).find((data) => data && phoneNumber(data.number) === number && data.name?.trim());
    return known ? known.name.trim() : number;
  }
  const chats = views.map((view) => ({ view, telegram: view.event?.payload?.data?.telegram })).filter((item) => item.telegram);
  if (party.startsWith('tg:')) {
    const id = party.slice(3);
    const chat = chats.find(({ telegram }) => telegram.chat_type === 'private' && String(telegram.chat_id) === id && telegram.chat_title);
    if (chat) return chat.telegram.chat_title;
    const sender = chats.find(({ view, telegram }) => String(telegram.from_id ?? '') === id || partyOf(view.event.author) === party);
    if (sender) return sender.telegram.from_name || sender.telegram.chat_title || party;
  }
  if (party.startsWith('group:tg:')) {
    const id = party.slice(9);
    const outbound = views.map((view) => view.event?.payload?.data?.outbound).find((data) => data && String(data.chat_id) === id && data.chat_title);
    const group = chats.find(({ telegram }) => String(telegram.chat_id) === id && telegram.chat_title)?.telegram.chat_title ?? outbound?.chat_title;
    if (group) return group;
  }
  return party;
}

// Someone by name or phone number, typed in place (no browser prompt): a number — `tel:`, else `name:`.
export function personParty(raw) {
  const text = raw.trim();
  const digits = text.replace(/[\s()-]/g, '');
  if (/^\+\d{5,}$/.test(digits)) return `tel:${digits}`;
  return text ? `name:${text.slice(0, 115)}` : null;
}
