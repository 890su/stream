// The dashboard — the centre by default (docs/plans/2026-11-21-workspace-redesign-design.md). It reads top-down, the
// most important on top (owner, 2026-11-21): the task in work first («Готово», «⏸ Пауза»), or «Вернуться к…» when
// nothing is in work; under it the paused tasks, the latest first; under them the next ones in the order of «До конца
// дня». Data: pulse.js; actions: taskquick.js. dashboardOrder is pure.
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

// Top to bottom: [{ kind: 'work' | 'paused' | 'next', task }].
export function dashboardOrder({ work = null, paused = [], today = [] }) {
  return [
    ...(work ? [{ kind: 'work', task: work }] : []),
    ...paused.map((task) => ({ kind: 'paused', task })),
    ...today.map((task) => ({ kind: 'next', task })),
  ];
}

const minutes = (value) => (value < 60 ? `${value} мин` : `${Math.floor(value / 60)} ч ${value % 60} мин`);
// Where to go on: the resume note (not the bare «в работе» of focus.js), else the first unticked item.
const nextOf = (task) => (task.resumeNote && task.resumeNote !== 'в работе' ? task.resumeNote : '') || task.items?.find((item) => !item.done)?.text || '';

// ctx: { tasks, projects, viewsOf(task), now, quick, config (registry/pulse.json), onOpen(id) }
export function dashboardNodes(ctx) {
  const { tasks, viewsOf, now, quick, config } = ctx;
  const blocks = pulseBlocks({ tasks, projects: ctx.projects ?? [], now, config });
  // Nothing in work: the newest paused task becomes «Вернуться к…» on top.
  const back = blocks.work ? null : blocks.paused[0] ?? null;
  const rows = dashboardOrder({ work: blocks.work, paused: back ? blocks.paused.slice(1) : blocks.paused, today: blocks.today });
  const nodes = [];
  const row = (task) => {
    const item = taskRow(task, viewsOf(task), { onOpen: ctx.onOpen, showAssignee: !isMineToDo(task), quick });
    if (quick?.start && isMineToDo(task) && task.status !== 'waiting') item.append(button('pulse-start', '▶', () => quick.start(task, blocks.work), `В работу: ${task.title}`));
    return item;
  };
  if (blocks.work) {
    const card = element('section', 'pulse-work');
    card.append(element('span', 'pulse-work-label', '⏵ В работе'));
    const facts = [minutes(workedMinutes(blocks.work, now)), nextOf(blocks.work) && `дальше: ${nextOf(blocks.work)}`].filter(Boolean).join(' · ');
    const actions = element('div', 'pulse-work-actions');
    actions.append(button('chip', 'Готово', () => quick?.done(blocks.work)), button('chip', '⏸ Пауза', () => quick?.pause(blocks.work)));
    card.append(button('pulse-work-title', blocks.work.title, () => ctx.onOpen(blocks.work.id)), element('span', 'pulse-work-facts', facts), actions);
    nodes.push(card);
  } else if (back) {
    const card = element('section', 'pulse-work paused');
    card.append(element('span', 'pulse-work-label', 'Вернуться к'), button('pulse-work-title', back.title, () => ctx.onOpen(back.id)),
      element('span', 'pulse-work-facts', nextOf(back) ? `дальше: ${nextOf(back)}` : 'на паузе'));
    const actions = element('div', 'pulse-work-actions');
    actions.append(button('chip', 'Вернуться', () => quick?.start(back, null)));
    card.append(actions);
    nodes.push(card);
  }
  let label = null;
  for (const { kind, task } of rows) {
    if (kind === 'work') continue;
    if (kind !== label) { nodes.push(element('div', 'dash-label', kind === 'next' ? 'Следующие' : '⏸ На паузе')); label = kind; }
    nodes.push(row(task));
  }
  if (!nodes.length) nodes.push(element('div', 'empty', 'Всё спокойно.'));
  return nodes;
}
