// The pulse on screen (task manager spec §5): the task in work with «Готово» / «Пауза», «Вернуться к…» when
// nothing is in work, then blocks «Горит · Сегодня · Слежу · Проекты · Дальше» — a head with a count, up to
// `rows` lines, «ещё N» unfolds; an empty block is one quiet line. Data: pulse.js; actions: taskquick.js.
import { pulseBlocks } from './pulse.js';
import { workedMinutes, isMineToDo } from './focus.js';
import { taskRow } from './tasklist.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick, label) {
  const node = element('button', className, text);
  node.type = 'button';
  node.onclick = onClick;
  if (label) node.setAttribute('aria-label', label);
  return node;
}

const minutes = (value) => (value < 60 ? `${value} мин` : `${Math.floor(value / 60)} ч ${value % 60} мин`);
// Where to go on: the resume note (not the bare «в работе» of focus.js), else the first unticked item.
const nextOf = (task) => (task.resumeNote && task.resumeNote !== 'в работе' ? task.resumeNote : '') || task.items?.find((item) => !item.done)?.text || '';
const HEALTH = { red: 'горит', yellow: 'внимание', green: 'идёт' };

// ctx: taskViewNodes' context plus { conversations, projects, config (registry/pulse.json), onOpenConversation,
//   onOpenProject, isOpenSection(key), toggle(key, open) }.
export function pulseNodes(ctx) {
  const { tasks, viewsOf, now, quick, config } = ctx;
  const b = pulseBlocks({ tasks, conversations: ctx.conversations ?? [], projects: ctx.projects ?? [], now, config });
  const nodes = [];
  const row = (task, { start = true } = {}) => {
    const item = taskRow(task, viewsOf(task), { onOpen: ctx.onOpen, showAssignee: !isMineToDo(task), quick });
    if (start && quick?.start && isMineToDo(task) && task.status !== 'waiting') item.append(button('pulse-start', '▶', () => quick.start(task, b.work), `В работу: ${task.title}`));
    return item;
  };

  // In work, or the last paused one to come back to.
  if (b.work) {
    const card = element('section', 'pulse-work');
    card.append(element('span', 'pulse-work-label', '⏵ В работе'));
    const title = button('pulse-work-title', b.work.title, () => ctx.onOpen(b.work.id));
    const facts = [minutes(workedMinutes(b.work, now)), nextOf(b.work) && `дальше: ${nextOf(b.work)}`].filter(Boolean).join(' · ');
    const actions = element('div', 'pulse-work-actions');
    actions.append(button('chip', 'Готово', () => quick?.done(b.work)), button('chip', '⏸ Пауза', () => quick?.pause(b.work)));
    card.append(title, element('span', 'pulse-work-facts', facts), actions);
    nodes.push(card);
  } else if (b.paused.length) {
    const back = b.paused[0];
    const card = element('section', 'pulse-work paused');
    card.append(element('span', 'pulse-work-label', 'Вернуться к'), button('pulse-work-title', back.title, () => ctx.onOpen(back.id)),
      element('span', 'pulse-work-facts', nextOf(back) ? `дальше: ${nextOf(back)}` : 'на паузе'));
    const actions = element('div', 'pulse-work-actions');
    actions.append(button('chip', 'Вернуться', () => quick?.start(back, null)));
    card.append(actions);
    nodes.push(card);
  }
  const waiting = b.work ? b.paused : b.paused.slice(1);
  const pausedHours = (task) => Math.floor((now.getTime() - Date.parse(task.updatedAt)) / 3_600_000);
  block(nodes, ctx, { key: 'paused', title: '⏸ Ждут возврата', items: waiting, folded: true, quietWhenEmpty: false,
    draw: (task) => {
      const item = row(task);
      if (pausedHours(task) >= config.paused_remind_hours) (item.querySelector('.task-meta') ?? item.querySelector('.task-text'))?.append(element('span', 'pulse-note', ` · на паузе ${pausedHours(task)} ч`));
      return item;
    } });

  const hotRow = (entry) => {
    if (entry.kind === 'task') return row(entry.task, { start: true });
    const item = button('pulse-person task-item', '', () => ctx.onOpenConversation?.(entry.conversation.key));
    item.append(element('span', 'task-title', `Ответить: ${entry.conversation.title}`), element('span', 'task-due-label overdue', `ждёт ${entry.waitingHours} ч`));
    return item;
  };
  block(nodes, ctx, { key: 'hot', title: '🔥 Горит', items: b.hot, draw: hotRow, quiet: 'Ничего не горит' });
  // Without a calendar the window is the rest of the working day (task manager spec §5.1).
  block(nodes, ctx, { key: 'today', title: '▶ До конца дня', items: b.today, draw: (task) => row(task), quiet: 'На сегодня всё сделано' });
  block(nodes, ctx, { key: 'watch', title: '👁 Слежу', folded: true, count: b.watchAlerts.length ? `${b.watch.length} · ⚠ ${b.watchAlerts.length}` : null,
    items: b.watch, draw: (task) => row(task, { start: false }), quiet: 'Слежу — всё по плану' });
  // The head counts open tasks of the projects, not the projects.
  block(nodes, ctx, { key: 'projects', title: '📊 Проекты', folded: true, count: String(b.projects.reduce((sum, item) => sum + item.open, 0)),
    items: b.projects, draw: (health) => projectRow(health, ctx), quiet: 'Нет активных проектов' });
  block(nodes, ctx, { key: 'later', title: '⏭ Дальше', items: b.later, draw: (task) => row(task), folded: true, quietWhenEmpty: false });

  if (!b.work && !b.paused.length && !b.hot.length && !b.today.length && !b.watch.length && !b.projects.length && !b.later.length) {
    nodes.splice(0, nodes.length, element('div', 'empty', 'Всё спокойно.'));
  }
  return nodes;
}

// One project line: health dot, title, 7-day movement, the reason when it is not moving well.
function projectRow(health, ctx) {
  const item = button(`pulse-project task-item ${health.health}`, '', () => ctx.onOpenProject?.(health.project.id), `${health.project.title}: ${HEALTH[health.health]}`);
  const text = element('span', 'task-text');
  text.append(element('span', 'task-title', health.project.title));
  const facts = [`↑${health.done7} сделано`, `${health.open} откр`];
  if (health.overdue) facts.push(`просрочено ${health.overdue}`);
  else if (health.project.kind === 'goal' && !health.next) facts.push('нет следующего шага');
  else if (health.staleDays >= ctx.config.stale_days) facts.push(`стоит ${health.staleDays} дн`);
  else if (health.next) facts.push(`шаг: ${health.next.title}`);
  text.append(element('span', 'task-meta', facts.join(' · ')));
  item.prepend(element('span', `pulse-dot ${health.health}`));
  item.append(text);
  return item;
}

// A block: head with a count; a tap on the head folds or unfolds it — `folded` blocks start closed (Ждут возврата,
// Слежу, Проекты, Дальше), the others open (Горит, До конца дня). Up to `rows` items, «ещё N» unfolds the rest. An
// empty block is one quiet line (or nothing, `quietWhenEmpty: false`). The fold is kept for this session (feed.js).
function block(nodes, ctx, { key, title, items, draw, count = null, quiet = '', folded = false, quietWhenEmpty = true }) {
  if (!items.length) {
    if (quietWhenEmpty && quiet) nodes.push(element('div', 'pulse-quiet', `✓ ${quiet}`));
    return;
  }
  const sectionKey = `pulse:${key}`;
  const flipped = ctx.isOpenSection(sectionKey); // toggled away from its default
  const open = folded ? flipped : !flipped;
  const head = element('button', 'task-section pulse-head');
  head.dataset.group = sectionKey; // the scroll anchor keeps its place when a block folds (feed.js)
  head.type = 'button';
  head.setAttribute('aria-expanded', String(open));
  head.onclick = () => ctx.flip(sectionKey, open);
  head.append(element('span', 'task-section-title', title), element('span', 'task-section-count', count ?? String(items.length)));
  nodes.push(head);
  if (!open) return;
  const moreKey = `pulse:${key}:more`;
  const all = ctx.isOpenSection(moreKey);
  const rows = ctx.config.rows;
  nodes.push(...(all ? items : items.slice(0, rows)).map(draw));
  if (!all && items.length > rows) nodes.push(button('pulse-more', `ещё ${items.length - rows}`, () => ctx.flip(moreKey, false)));
  ctx.keepRows?.(sectionKey, nodes.slice(nodes.indexOf(head) + 1)); // folding animates these rows
}
