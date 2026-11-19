// The «Задачи» view of the centre (CONCEPT.md §5, §2.11): either a saved list — chips of the main lists, then its
// sections or groups — or one project by its sections (projectview.js). Returns the nodes; feed.js places them.
import { visibleTasks } from './filters.js';
import { taskRow, emptyTasks, sectionsOf, sectionHeader, listHead, listCount, groupsOf } from './tasklist.js';
import { projectHead, projectSectionHead, projectSections } from './projectview.js';
import { pulseNodes } from './pulseview.js';
import { PULSE_DEFAULTS } from './pulse.js';

// ctx: { tasks, viewsOf(task), now, filters, filter, matches, grouping, onGroup, onPick, onMore, onOpen, quick,
//   isOpenSection(key), toggle(key, open), keepRows(key, rows), project, projects, projectActions,
//   conversations, pulseConfig, onOpenConversation(key), onOpenProject(id) } — the last four for the pulse (pulseview.js)
export function taskViewNodes(ctx) {
  const { tasks, viewsOf, now, filter, matches, quick } = ctx;
  const nodes = [];
  const row = (task, { showProject = true } = {}) => taskRow(task, viewsOf(task), { onOpen: ctx.onOpen, showAssignee: filter.id !== 'today', showProject, quick });
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
  // The pulse is the screen (task manager spec §5): no list chips; the lists are in the left panel.
  if (filter.view === 'pulse') return pulseNodes({ ...ctx, tasks: tasks.filter(matches), config: ctx.pulseConfig ?? PULSE_DEFAULTS });
  const shown = visibleTasks(tasks, { filter, matches, now });
  // A list opened from the left panel: its name, «← Пульт» back, the grouping.
  const pulse = ctx.filters.find((item) => item.view === 'pulse');
  nodes.push(listHead(filter, listCount(shown, filter, now), { onBack: pulse ? () => ctx.onPick(pulse.id) : null, grouping: ctx.grouping, onGroup: ctx.onGroup }));
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
