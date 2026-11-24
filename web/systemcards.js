// The System screen by cards (owner, 2026-11-21): one card per connection — channels (Telegram, WhatsApp, Viber, the
// phone) and services (Google Calendar, the AI triage) — with a dot, the state in words, when it was last heard from
// and an on/off switch; a tap opens what belongs to it. What needs attention (an error, a login, silence, failed
// sends) is lifted on top; a connection switched off is not a problem. systemGroups and cardFacts are pure (tested in
// node); card builds the DOM.

const STATE = { ok: 'работает', silent: 'молчит', login_required: 'нужен вход', error: 'ошибка', off: 'выключен', unset: 'не подключён' };
const CHANNELS = ['telegram_by', 'telegram_pl', 'whatsapp_pl', 'viber', 'android_phone'];
const SERVICES = ['google_calendar', 'ai_triage'];
const GUIDES = { telegram_by: 'TELEGRAM.md', telegram_pl: 'TELEGRAM.md', whatsapp_pl: 'WHATSAPP.md', viber: 'DESKTOP.md', android_phone: 'PHONE.md', google_calendar: 'GOOGLE.md' };
const REPO = 'https://github.com/890su/stream/blob/main/deploy/';

const rank = (list, id) => { const index = list.indexOf(id); return index < 0 ? list.length : index; };
// A problem: an error, a login, silence, failed sends. Switched off or never set up is not one.
const needsAttention = (item) => !['off', 'unset'].includes(item.state) && (['error', 'login_required', 'silent'].includes(item.state) || item.failed_24h > 0);

// { attention, channels, services } — the sources of /api/system in the screen's order.
export function systemGroups(sources) {
  const order = [...CHANNELS, ...SERVICES];
  const sorted = [...sources].sort((a, b) => rank(order, a.source) - rank(order, b.source) || String(a.title).localeCompare(String(b.title), 'ru'));
  return {
    attention: sorted.filter(needsAttention),
    channels: sorted.filter((item) => !SERVICES.includes(item.source)),
    services: sorted.filter((item) => SERVICES.includes(item.source)),
  };
}

function ago(iso, now) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} ч назад`;
  return `${Math.round(minutes / 1440)} дн назад`;
}

// { state, when, attention, guide } — the words of a card's row.
export function cardFacts(item, now = Date.now()) {
  const state = `${STATE[item.state] ?? item.state}${item.failed_24h && item.state !== 'off' ? ` · не отправлено: ${item.failed_24h}` : ''}`;
  const when = item.last_event_at ? `сообщение ${ago(item.last_event_at, now)}` : item.pulse_at ? `сигнал ${ago(item.pulse_at, now)}` : 'ещё ни разу';
  return { state, when, attention: needsAttention(item), guide: GUIDES[item.source] ? `${REPO}${GUIDES[item.source]}` : null };
}

// The AI triage card (docs/plans/2026-11-21-ai-proposals-design.md): what became of its decisions over 7 days —
// `decisions` is { kind: { status: count } } of the AI log; undefined — not reported yet. Since v21 a `link` is applied
// by itself (`auto`, `undone` when taken back), changes are proposed as `update`, doubts asked as `question`.
export function aiStatsLines(decisions) {
  if (!decisions) return [];
  const sum = (group) => Object.values(group ?? {}).reduce((a, b) => a + b, 0);
  const lines = [];
  const { auto: linked = 0, undone: unlinked = 0, replaced: relinked = 0, ...asked } = decisions.link ?? {};
  if (sum(asked)) lines.push(`Предложил связать с задачей: ${sum(asked)} — принято ${asked.accepted ?? 0}, в другую задачу ${asked.redirected ?? 0}, отклонено ${asked.rejected ?? 0}, ждут ответа ${asked.pending ?? 0}`);
  if (linked + unlinked + relinked) lines.push(`Связал с записями: ${linked + unlinked + relinked}, из них снято мной ${unlinked}`);
  const update = decisions.update ?? {};
  if (sum(update)) lines.push(`Предложил правку записи: ${sum(update)} — принято ${update.accepted ?? 0}, отклонено ${update.rejected ?? 0}, ждут ответа ${update.pending ?? 0}`);
  const question = decisions.question ?? {};
  if (sum(question)) lines.push(`Спросил: ${sum(question)}, ждут ответа ${question.pending ?? 0}`);
  const made = { auto: (decisions.create?.auto ?? 0) + (decisions.unsorted?.auto ?? 0), undone: (decisions.create?.undone ?? 0) + (decisions.unsorted?.undone ?? 0) };
  if (made.auto + made.undone) lines.push(`Создал задач: ${made.auto + made.undone}, из них отменено или разобрано иначе ${made.undone}`);
  const filed = sum(decisions.filed);
  const kept = sum(decisions.conversation_only);
  if (filed || kept) lines.push(`Подшил без дела: ${filed}; оставил в беседе: ${kept}`);
  return lines.length ? lines : ['За 7 дней решений ИИ не было'];
}

// How the AI makes new tasks (src/ownersettings.ts, design 2026-11-21): the two choices, the current one `on`.
export function triageModeChoice(value) {
  const current = value === 'confirmed' ? 'confirmed' : 'unconfirmed';
  return [{ value: 'unconfirmed', title: 'ИИ предлагает — я подтверждаю' }, { value: 'confirmed', title: 'ИИ создаёт сразу' }]
    .map((item) => ({ ...item, on: item.value === current }));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A card: the row (dot, title, state, when, switch) and, when open, `body()` — the nodes of this connection.
// ctx: { open (boolean), onToggle(open), onSwitch(on), body() → Promise<Node[]> }.
export function card(item, { open = false, onToggle, onSwitch, body }) {
  const facts = cardFacts(item);
  const box = element('section', `system-card${open ? ' open' : ''}${facts.attention ? ' attention' : ''}`);
  const head = element('div', 'system-card-head');
  const opener = element('button', 'system-card-open');
  opener.type = 'button';
  opener.setAttribute('aria-expanded', String(open));
  opener.append(element('span', `system-dot ${item.state}`), element('span', 'system-name', item.title),
    element('span', 'system-card-state', facts.state), element('span', 'system-card-when', facts.when));
  opener.onclick = () => onToggle(!open);
  const toggle = element('label', 'system-switch');
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: item.on });
  input.setAttribute('aria-label', `${item.title}: ${item.on ? 'выключить' : 'включить'}`);
  input.onchange = () => onSwitch(input.checked, input);
  toggle.append(input, element('span', 'system-switch-track'));
  head.append(opener, toggle);
  box.append(head);
  if (open) {
    const inside = element('div', 'system-card-body');
    if (item.detail && !['ok', 'off'].includes(item.state)) inside.append(element('p', 'system-detail', item.detail));
    if (item.state === 'off') inside.append(element('p', 'system-detail', 'Выключен на «Системе»: настройки и ключи сохранены, включите — продолжит с места остановки.'));
    box.append(inside);
    void body().then((nodes) => {
      inside.append(...nodes);
      if (facts.guide) inside.append(Object.assign(document.createElement('a'), { className: 'link-button system-guide', href: facts.guide, target: '_blank', rel: 'noopener', textContent: 'Как подключить' }));
    });
  }
  return box;
}
