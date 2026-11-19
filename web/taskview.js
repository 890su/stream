// The «Задачи» view of the centre (CONCEPT.md §5, §2.11): either a saved list — chips of the main lists, then its
// sections or groups — or one project by its sections (projectview.js). Returns the nodes; feed.js places them.
import { visibleTasks } from './filters.js';
import { taskRow, emptyTasks, sectionsOf, sectionHeader, listChips, listCount, groupsOf } from './tasklist.js';
import { projectHead, projectSectionHead, projectSections } from './projectview.js';

// ctx: { tasks, viewsOf(task), now, filters, filter, matches, grouping, onGroup, onPick, onMore, onOpen, quick,
//   isOpenSection(key), toggle(key, open), keepRows(key, rows), project, projects, projectActions }
export function taskViewNodes(ctx) {
  const { tasks, viewsOf, now, filter, matches, quick } = ctx;
  const nodes = [];
  const row = (task, { showProject = true } = {}) => taskRow(task, viewsOf(task), { onOpen: ctx.onOpen, showAssignee: filter.id !== ctx.filters[0].id, showProject, quick });
  if (ctx.project) {
    // One project: its header, then every section (empty ones too: the plan stays visible), loose tasks first.
    const shown = tasks.filter(matches).filter((task) => !['cancelled'].includes(task.status) && (task.status !== 'done' || ctx.showDone));
    nodes.push(projectHead(ctx.project, shown, ctx.projectActions));
    for (const section of projectSections(ctx.project, shown)) {
      if (section.title) nodes.push(projectSectionHead(section, ctx.project, ctx.projectActions));
      nodes.push(...section.tasks.map((task) => row(task, { showProject: false })));
    }
    return nodes;
  }
  const counts = new Map(ctx.filters.filter((item) => item.pinned || item.id === filter.id)
    .map((item) => [item.id, listCount(visibleTasks(tasks, { filter: item, matches, now }), item, now)]));
  nodes.push(listChips(ctx.filters, filter, counts, { onPick: ctx.onPick, onMore: ctx.onMore, grouping: ctx.grouping, onGroup: ctx.onGroup }));
  const shown = visibleTasks(tasks, { filter, matches, now });
  const grouped = ctx.grouping === 'due' ? sectionsOf(shown, filter, now) : groupsOf(shown, ctx.grouping, viewsOf);
  for (const section of grouped) {
    const key = `section:${filter.id}:${section.id}`;
    const open = !section.folded || ctx.isOpenSection(key);
    if (section.title) {
      const head = sectionHeader(section, { open, onToggle: () => ctx.toggle(key, open) });
      head.dataset.group = key;
      nodes.push(head);
    }
    if (open) {
      const rows = section.tasks.map((task) => row(task));
      if (section.folded) ctx.keepRows(key, rows);
      nodes.push(...rows);
    }
  }
  if (!shown.length) nodes.push(emptyTasks(filter));
  return nodes;
}
