// The header of a case in the feed (CONCEPT.md §2.9): title, with whom, number of messages, time of the last one.
// Tapping it shows or hides the latest messages right in the feed; the button on the right opens the whole case.
import { withWhom } from './cases.js';
import { STATUSES, ASSIGNEES } from './taskfold.js';

const OPEN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>';
const time = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const plural = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'сообщение' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'сообщения' : 'сообщений');

export function caseHeader(item, { shown, onToggle, onOpen }) {
  const { task, views } = item;
  const last = new Date(item.last);
  const sameDay = last.toDateString() === new Date().toDateString();
  const row = element('div', `case-head${item.stage ? ` done ${item.stage}` : ''}${task.status === 'inbox' ? ' inbox' : ''}`);
  row.dataset.task = task.id;
  row.dataset.group = `case:${task.id}`;
  const toggle = element('button', 'case-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(shown > 0));
  const title = element('span', 'case-title', `${item.stage ? '✓ ' : ''}${task.title}`);
  const facts = [
    withWhom(views).slice(0, 2).join(', ') || null,
    `${views.length} ${plural(views.length)}`,
    task.proposed === 'done' && !item.stage ? 'готово?' : !item.stage && task.status !== 'todo' ? STATUSES[task.status] : null,
    task.assignee !== 'me' ? ASSIGNEES[task.assignee] : null,
  ].filter(Boolean);
  const meta = element('span', 'case-meta', facts.join(' · '));
  const when = element('span', 'case-time', sameDay ? time.format(last) : date.format(last));
  toggle.append(element('span', 'case-arrow', shown > 0 ? '▾' : '▸'), title, when, meta);
  toggle.setAttribute('aria-label', `${task.title}: ${shown > 0 ? 'свернуть' : 'показать последние сообщения'}`);
  toggle.onclick = onToggle;
  const open = element('button', 'icon-button case-open');
  open.type = 'button';
  open.innerHTML = OPEN_ICON;
  open.setAttribute('aria-label', `Открыть дело «${task.title}» целиком`);
  open.onclick = onOpen;
  row.append(toggle, open);
  return row;
}
