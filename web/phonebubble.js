// Calls and SMS from the phone companion (CONCEPT.md §8.1): the header block inside a feed bubble.
// phoneLabel is pure (tested in node); phoneBlock builds the DOM. User content goes in through textContent only.

const ICONS = {
  in: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h2.6l1.5 4-2 1.3a10.5 10.5 0 0 0 6.5 6.5l1.3-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z"/><path d="M20 4l-5 5M15 5v4h4"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h2.6l1.5 4-2 1.3a10.5 10.5 0 0 0 6.5 6.5l1.3-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z"/><path d="M15 9l5-5M16 4h4v4"/></svg>',
  missed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h2.6l1.5 4-2 1.3a10.5 10.5 0 0 0 6.5 6.5l1.3-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z"/><path d="M15 4l5 5M20 4l-5 5"/></svg>',
  sms: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4.5 3v-14a1 1 0 0 1 1-1Z"/><path d="M8 10h8M8 13.5h5"/></svg>',
};
const CALL_TITLES = { in: 'Входящий', out: 'Исходящий', missed: 'Пропущенный', rejected: 'Отклонённый', unknown: 'Звонок' };

function duration(seconds) {
  if (seconds < 60) return `${seconds} с`;
  if (seconds < 3600) return seconds % 60 ? `${Math.floor(seconds / 60)} мин ${seconds % 60} с` : `${seconds / 60} мин`;
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes ? `${Math.floor(seconds / 3600)} ч ${minutes} мин` : `${Math.floor(seconds / 3600)} ч`;
}

// { icon, title, who, number }: who is the name, else the number, else "Скрытый номер"; number only when known.
export function phoneLabel(event) {
  const data = event.kind === 'call' ? event.payload?.data?.call ?? {} : event.payload?.data?.sms ?? {};
  const number = (data.number ?? '').trim() || null;
  const who = (data.name ?? '').trim() || number || 'Скрытый номер';
  if (event.kind === 'sms') {
    const incoming = data.direction === 'in';
    return { icon: incoming ? 'sms-in' : 'sms-out', title: incoming ? 'Входящее SMS' : 'Отправленное SMS', who, number };
  }
  const direction = CALL_TITLES[data.direction] ? data.direction : 'unknown';
  const talked = (direction === 'in' || direction === 'out') && data.duration_s > 0;
  return { icon: direction === 'unknown' ? 'in' : direction, title: talked ? `${CALL_TITLES[direction]} · ${duration(data.duration_s)}` : CALL_TITLES[direction], who, number };
}

export const isPhoneEvent = (event) => event?.kind === 'call' || event?.kind === 'sms';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The header of a call or SMS bubble. "Описать" uses the same data-continue hook as the continue icon (actions.js).
export function phoneBlock(view) {
  const label = phoneLabel(view.event);
  const box = element('div', 'phone-block');
  const head = element('div', `phone-head ${label.icon}`);
  const icon = element('span', 'phone-icon');
  icon.innerHTML = label.icon.startsWith('sms') ? ICONS.sms : ICONS[label.icon];
  head.append(icon, element('span', '', label.title));
  const who = element('div', 'phone-who');
  if (label.number) {
    const link = element('a', '', label.who);
    link.href = `tel:${label.number.replace(/[^\d+]/g, '')}`;
    who.append(link);
    if (label.who !== label.number) who.append(element('span', 'phone-number', label.number));
  } else who.textContent = label.who;
  box.append(head, who);
  if (view.event.kind === 'call') {
    const describe = element('button', 'phone-describe', 'Описать');
    describe.type = 'button';
    describe.dataset.continue = '';
    describe.setAttribute('aria-label', 'Описать звонок');
    box.append(describe);
  }
  return box;
}
