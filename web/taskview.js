// The «Задачи» centre (task view panel, 2026-11-19): what the left panel's view (viewstate.js) asks for — the pulse of
// its tasks, one project by its sections (the view's project with «Все открытые»), or a list by dates (or by tags /
// people) under a head with the view in words and «← Пульт». Returns the nodes; feed.js places them.
import { taskRow, sectionHeader, listHead, groupsOf } from './tasklist.js';
import { projectHead, projectSectionHead, projectSections } from './projectview.js';
import { pulseNodes } from './pulseview.js';
import { PULSE_DEFAULTS } from './pulse.js';
import { applyView, dueGroups, viewTitle, DEFAULT_VIEW } from './viewstate.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ctx: { tasks, viewsOf(task), now, matches (tags / a conversation), view, projects, people, counterparties, grouping,
//   onGroup, onResetView, onOpen, quick, isOpenSection(key), toggle(key, open), keepRows(key, rows), project,
//   projectActions, showDone, pulseConfig, onOpenProject(id) }
export function taskViewNodes(ctx) {
  const { viewsOf, now, quick } = ctx;
  const view = ctx.view ?? DEFAULT_VIEW;
  const data = { now, projects: ctx.projects ?? [], people: ctx.people ?? [] };
  const tasks = ctx.tasks.filter(ctx.matches ?? (() => true));
  const nodes = [];
  const row = (task, { showProject = true } = {}) => taskRow(task, viewsOf(task), { onOpen: ctx.onOpen, showAssignee: true, showProject, quick });

  if (ctx.project) {
    // One project: its header, then every section (empty ones too: the plan stays visible), loose tasks first.
    const shown = applyView(tasks, { ...view, when: 'pulse' }, data).filter((task) => task.status !== 'cancelled' && (task.status !== 'done' || ctx.showDone));
    nodes.push(projectHead(ctx.project, shown, ctx.projectActions));
    for (const section of projectSections(ctx.project, shown)) {
      if (section.title) nodes.push(projectSectionHead(section, ctx.project, ctx.projectActions));
      nodes.push(...section.tasks.map((task) => row(task, { showProject: false })));
    }
    return nodes;
  }
  // The pulse of the view's tasks (task manager spec §5): narrowed by whose and where, if chosen.
  if (view.when === 'pulse') return pulseNodes({ ...ctx, tasks: applyView(tasks, view, data), config: ctx.pulseConfig ?? PULSE_DEFAULTS });

  const shown = applyView(tasks, view, data);
  nodes.push(listHead({ title: viewTitle(view, ctx) }, shown.length, { onBack: ctx.onResetView, grouping: ctx.grouping, onGroup: ctx.onGroup }));
  const grouped = ctx.grouping === 'due' || !ctx.grouping ? dueGroups(shown, now) : groupsOf(shown, ctx.grouping, viewsOf);
  for (const group of grouped) {
    const key = `view:${group.id}`;
    const open = !ctx.isOpenSection(key); // every group starts open; a tap folds it
    const head = sectionHeader({ ...group, folded: true }, { open, onToggle: () => ctx.flip(key, open) });
    head.dataset.group = key;
    nodes.push(head);
    if (open) {
      const rows = group.tasks.map((task) => row(task));
      ctx.keepRows(key, rows);
      nodes.push(...rows);
    }
  }
  if (!shown.length) nodes.push(element('div', 'empty', view.when === 'done' ? 'Готовых задач здесь нет.' : 'Здесь пусто — всё сделано или ничего не подходит.'));
  return nodes;
}
