// A tile of the «Беседы» queue (CONCEPT.md §5, docs/plans/2026-11-20-queue-and-task-screen-design.md): line 1 —
// the kind of chat, the channel and the contact, the time; line 2 — the conversation's task (with «?» when the AI
// chose it) or «+ задача…» to type one; lines 3–4 — the last message; on the right «⏱ Отложить» and «↧ В конец
// очереди»; a small line — how long it waits, how many messages, the counterparty, a tag or two. A tile of the archive
// under the queue (`archived`) has no «⏱»/«↧» and says when it was handled or until when it is snoozed. tileTask,
// pickTask and tileFacts are pure (tested in node); convRow builds the DOM.
import { snippet } from './projection.js';
import { isOpen, dueState } from './taskfold.js';

const time = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const KIND_ICONS = { chat: '💬', group: '👥', phone: '📞', me: '📝' };

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
export const tasksLabel = (n) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`;

// Urgency of open tasks: overdue, due today, waiting for a decision, then the most recently changed (topic.js too).
export function byUrgency(now = new Date()) {
  const rank = (task) => {
    const due = dueState(task, now);
    return due === 'overdue' ? 0 : due === 'today' ? 1 : ['inbox', 'review'].includes(task.status) ? 2 : 3;
  };
  return (a, b) => rank(a) - rank(b) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
}

// The task a swipe or a tap opens: the most urgent open one (byUrgency).
export function pickTask(conversation, now = new Date()) {
  return conversation.tasks.filter((task) => isOpen(task) && !task.filed).sort(byUrgency(now))[0] ?? null;
}

// The task of a tile: the most urgent open one holding a waiting message — the AI put it there (`guessed`) —, else
// the conversation's most urgent open task, else null.
export function tileTask(conversation, now = new Date()) {
  const pending = new Set((conversation.queue?.pending ?? []).map((view) => view.id));
  const real = conversation.tasks.filter((task) => !task.unconfirmed); // the AI's unconfirmed task is the topic's offer, not its task
  const holding = real.filter((task) => (task.messages ?? []).some((id) => pending.has(id)));
  const guessed = pickTask({ tasks: holding }, now);
  if (guessed) return { task: guessed, guessed: true };
  const task = pickTask({ tasks: real }, now);
  return task ? { task, guessed: false } : null;
}

// The channel of a message in short: TG BY, TG PL, WA PL, Viber, SMS, Тел.
function channelOf(event) {
  const data = event?.payload?.data ?? {};
  if (data.telegram) return `TG ${String(data.telegram.account).toUpperCase()}`;
  if (data.whatsapp) return `WA ${String(data.whatsapp.account).toUpperCase()}`;
  if (data.viber) return 'Viber';
  const connector = data.outbound?.connector ?? '';
  if (connector.startsWith('telegram_')) return `TG ${connector.slice(9).toUpperCase()}`;
  if (connector.startsWith('whatsapp_')) return `WA ${connector.slice(9).toUpperCase()}`;
  if (connector === 'viber') return 'Viber';
  if (event?.kind === 'sms') return 'SMS';
  if (event?.kind === 'call') return 'Тел';
  return 'Я';
}

const moment = (iso, now) => { const at = new Date(iso); return at.toDateString() === now.toDateString() ? time.format(at) : `${date.format(at)}, ${time.format(at)}`; };

const waitedLabel = (ms) => {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} ч` : `${Math.floor(hours / 24)} дн`;
};

// What a tile says. `hotHours` — `hot_wait_hours` of the pulse; `counterparties` — the directory's.
export function tileFacts(conversation, { now = new Date(), hotHours = 2, counterparties = [] } = {}) {
  const live = conversation.views.filter((view) => !view.deleted);
  const last = live.at(-1);
  const pending = conversation.queue?.pending ?? [];
  const at = new Date(conversation.last);
  const chosen = tileTask(conversation, now);
  const waitedMs = conversation.queue?.moment ? now.getTime() - Date.parse(conversation.queue.moment) : 0;
  const counterparty = chosen?.task.counterparty ? counterparties.find((item) => item.id === chosen.task.counterparty)?.title ?? null : null;
  return {
    kind: conversation.key === 'me' || conversation.key.startsWith('task:') ? 'me' : conversation.group ? 'group' : conversation.key.startsWith('tel:') && ['call', 'sms'].includes(last?.event.kind) ? 'phone' : 'chat',
    channel: channelOf((pending.at(-1) ?? last)?.event),
    title: conversation.title,
    task: chosen ? { id: chosen.task.id, title: chosen.task.title, guessed: chosen.guessed } : null,
    snippet: last ? snippet(last) : '',
    mine: last?.event.author === 'me' && !['call', 'sms'].includes(last.event.kind),
    when: at.toDateString() === now.toDateString() ? time.format(at) : date.format(at),
    waited: waitedLabel(waitedMs),
    // Unfinished (queue.js): what the other side still waits for; the state line says it instead of «ждёт».
    open: conversation.queue?.open ?? null,
    state: conversation.queue?.open ? `${conversation.queue.open} · ${waitedLabel(waitedMs)}` : `ждёт ${waitedLabel(waitedMs)}`,
    hot: waitedMs >= hotHours * 3_600_000,
    count: pending.length,
    counterparty,
    tags: [...new Set(pending.flatMap((view) => view.tags ?? []))].slice(0, 2),
    // The archive (queue.js archiveList): handled when, or snoozed until when.
    handled: conversation.handledAt ? moment(conversation.handledAt, now) : null,
    snoozedUntil: conversation.queue?.snoozedUntil ? moment(conversation.queue.snoozedUntil, now) : null,
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The tile. `on` — { open(key), task(id), newTask(title) }; `decorate` adds the swipes;
// `archived` — a tile of the archive above the queue.
export function convRow(conversation, { now = new Date(), hotHours, counterparties, on, decorate, archived = false }) {
  const facts = tileFacts(conversation, { now, hotHours, counterparties });
  const row = element('div', `conv-tile${archived ? ' archived' : facts.hot ? ' hot' : ''}`);
  row.dataset.conversation = conversation.key;
  const body = element('div', 'conv-body');
  body.setAttribute('role', 'button');
  body.tabIndex = 0;
  const state = archived ? (facts.snoozedUntil ? `⏱ отложена до ${facts.snoozedUntil}` : facts.handled ? `разобрана ${facts.handled}` : '') : facts.state;
  body.setAttribute('aria-label', [facts.title, facts.channel, facts.task?.title, facts.snippet, state].filter(Boolean).join(', '));
  const head = element('div', 'conv-head');
  // The time at the end of the title line (owner, 2026-11-22): the lines under it run from edge to edge.
  head.append(element('span', 'conv-kind', KIND_ICONS[facts.kind]), element('span', 'conv-channel', facts.channel), element('span', 'conv-title', facts.title),
    element('span', 'conv-time', facts.when));
  // Line 2: the task (a tap opens it) or a field to make one from what waits.
  let taskLine;
  if (facts.task) {
    taskLine = element('button', `conv-task${facts.task.guessed ? ' guessed' : ''}`, `▸ ${facts.task.title}${facts.task.guessed ? ' ?' : ''}`);
    taskLine.type = 'button';
    taskLine.setAttribute('aria-label', `Задача: ${facts.task.title}${facts.task.guessed ? ', выбрана разбором' : ''}`);
    taskLine.onclick = (event) => { event.stopPropagation(); on.task(facts.task.id); };
  } else {
    taskLine = element('input', 'conv-newtask');
    taskLine.type = 'text';
    taskLine.placeholder = '+ задача…';
    taskLine.enterKeyHint = 'done';
    taskLine.setAttribute('aria-label', 'Новая задача из беседы');
    taskLine.onclick = (event) => event.stopPropagation();
    taskLine.onkeydown = (event) => {
      if (event.key !== 'Enter' || !taskLine.value.trim()) return;
      event.preventDefault();
      on.newTask(taskLine.value.trim().slice(0, 120));
      taskLine.value = '';
      taskLine.blur();
    };
  }
  const text = element('div', 'conv-snippet', `${facts.mine ? 'Вы: ' : ''}${facts.snippet}`);
  const meta = element('div', 'conv-meta', [state, !archived && facts.count > 1 ? `${facts.count} новых` : '', facts.counterparty ?? '', ...facts.tags].filter(Boolean).join(' · '));
  body.append(head, taskLine, text, meta);
  body.onclick = () => on.open(conversation.key);
  body.onkeydown = (event) => { if (event.key === 'Enter' && event.target === body) on.open(conversation.key); };
  // No buttons (owner, 2026-11-22): a swipe — or the mouse at an edge — puts it off, to the end of the queue or to the
  // archive (convquick.js, snoozetiles.js); the conversation's head has ⏱ ↧ 🗄 too.
  row.append(body);
  decorate?.(row, conversation); // swipes: to the archive and the task (convquick.js)
  return row;
}
