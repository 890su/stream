// Projects (CONCEPT.md §2.11): the fold of project_change events, the tree for the left panel, a project's tasks by
// its sections, and next actions — open tasks in the «next» section of an active project with a goal, which «Сегодня»
// shows. A task lives in exactly one project (task.project) or in «Входящие». Pure: no DOM — tested in node.
import { isOpen } from './taskfold.js';

export const KINDS = { stream: 'Поток', goal: 'Проект с целью' };
// Sources a project may take by default (CONCEPT.md §2.11); Telegram accounts come from the registry.
export const SOURCE_TITLES = { me: 'Мои заметки', phone: 'Телефон' };

export const PROJECT_STATUSES = { active: 'активный', paused: 'на паузе', done: 'готов', archived: 'в архиве' };

// Sections a new project starts with; the owner renames, adds and removes them.
export function defaultSections(kind) {
  return kind === 'goal'
    ? [{ id: 'ideas', title: 'Идеи', role: 'ideas' }, { id: 'next', title: 'Следующее', role: 'next' }, { id: 'later', title: 'Позже' }]
    : [];
}

const order = (a, b) => a.ts.localeCompare(b.ts) || (a.received_at ?? '￿').localeCompare(b.received_at ?? '￿');

export function foldProjects(events) {
  const projects = new Map();
  for (const event of events.filter((item) => item.kind === 'project_change').sort(order)) {
    const id = event.payload?.ref?.id;
    const change = event.payload?.data?.project ?? {};
    let project = projects.get(id);
    if (!project) {
      if (change.op !== 'create') continue;
      project = { id, title: change.title, parent: null, kind: 'stream', status: 'active', sections: [], sources: [], scope: '', createdAt: event.ts, updatedAt: event.ts };
      projects.set(id, project);
    }
    for (const key of ['title', 'parent', 'kind', 'status', 'sections', 'sources', 'scope']) if (change[key] !== undefined) project[key] = change[key];
    project.updatedAt = event.ts;
  }
  // A parent that does not exist (or a loop) puts the project at the top.
  for (const project of projects.values()) {
    const seen = new Set([project.id]);
    let parent = project.parent;
    while (parent && projects.has(parent) && !seen.has(parent)) { seen.add(parent); parent = projects.get(parent).parent; }
    if (project.parent && (!projects.has(project.parent) || (parent && seen.has(parent)))) project.parent = null;
  }
  return [...projects.values()];
}

// The project of a task, only if it exists (a deleted or unknown project means «Входящие»).
export const projectOf = (task, byId) => (task.project && byId.get(task.project)) || null;

// Marks open tasks that are next actions: in an active goal project, in its «next» section. In place; returns tasks.
export function markNext(tasks, projects) {
  const byId = new Map(projects.map((project) => [project.id, project]));
  for (const task of tasks) {
    const project = projectOf(task, byId);
    const section = project?.sections.find((item) => item.id === task.section);
    task.projectTitle = project?.title ?? null;
    task.idea = Boolean(project && section?.role === 'ideas'); // the backlog stays out of «Сегодня»
    task.next = Boolean(project && project.kind === 'goal' && project.status === 'active' && section?.role === 'next' && isOpen(task));
  }
  return tasks;
}

// The tree for the left panel: [{ project, depth, open (open tasks in it and below) }], parents before children,
// by title; finished and archived projects only with `all`.
export function projectTree(projects, tasks, { all = false } = {}) {
  const shown = projects.filter((project) => all || project.status === 'active' || project.status === 'paused');
  const ids = new Set(shown.map((project) => project.id));
  const children = new Map();
  for (const project of shown) {
    const parent = project.parent && ids.has(project.parent) ? project.parent : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(project);
  }
  const own = new Map();
  for (const task of tasks) if (task.project && isOpen(task) && !task.filed) own.set(task.project, (own.get(task.project) ?? 0) + 1);
  const total = (id) => (own.get(id) ?? 0) + (children.get(id) ?? []).reduce((sum, child) => sum + total(child.id), 0);
  const rows = [];
  const walk = (parent, depth) => {
    for (const project of [...(children.get(parent) ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'ru'))) {
      rows.push({ project, depth, open: total(project.id) });
      walk(project.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

// A project and everything nested in it: the ids a project filter matches.
export function projectScope(projects, id) {
  const scope = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const project of projects) if (project.parent && scope.has(project.parent) && !scope.has(project.id)) { scope.add(project.id); grew = true; }
  }
  return scope;
}

// A project's tasks by its sections, like sectionsOf in tasklist.js: tasks with an unknown or no section go to
// «Без раздела» first; the «Позже»-like sections stay open; empty sections are kept so the plan is visible.
export function projectSections(project, tasks) {
  const known = new Set(project.sections.map((section) => section.id));
  const loose = tasks.filter((task) => !known.has(task.section));
  const sections = project.sections.map((section) => ({ id: section.id, title: section.title, role: section.role ?? null, tasks: tasks.filter((task) => task.section === section.id), folded: false, keep: true }));
  return [...(loose.length || !sections.length ? [{ id: 'loose', title: sections.length ? 'Без раздела' : '', tasks: loose, folded: false }] : []), ...sections];
}
