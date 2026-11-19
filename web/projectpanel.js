// Projects outside the project view (CONCEPT.md §2.11): the tree in the left panel of Задачи (a tap opens the project,
// «+ Проект» creates one) and the «Проект» line in task details (which project and section the task lives in).
import { projectTree, defaultSections, KINDS } from './projects.js';
import { inlineForm } from './projectview.js';

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

// The tree: `onOpen(id)` opens a project; `onCreate({ title, kind, sections })` makes one; `all` shows finished too.
export function projectTreeBlock({ projects, tasks, current, onOpen, onCreate, all = false, onAll }) {
  const box = element('div', 'drawer-projects');
  const rows = projectTree(projects, tasks, { all });
  for (const { project, depth, open } of rows) {
    const row = button(`drawer-contact project-row${project.id === current ? ' on' : ''}${project.status === 'active' ? '' : ' muted'}`, '', () => onOpen(project.id));
    row.style.paddingInlineStart = `${12 + depth * 16}px`;
    row.append(element('span', 'drawer-title', `${project.kind === 'goal' ? '◎' : '▸'} ${project.title}`), element('span', 'drawer-count', open ? String(open) : ''));
    row.setAttribute('aria-pressed', String(project.id === current));
    box.append(row);
  }
  if (!rows.length) box.append(element('p', 'drawer-empty', 'Проектов пока нет: «Поток» — работа без конца (удалёнка, заявки), «С целью» — с планом и следующим шагом.'));
  const tools = element('div', 'chips');
  const create = (kind) => () => tools.after(inlineForm(`Новый проект: ${KINDS[kind]}`, (title) => onCreate({ title, kind, sections: defaultSections(kind) }), { max: 120 }));
  tools.append(button('chip suggest', '+ Поток', create('stream'), 'Новый проект без конца'), button('chip suggest', '+ С целью', create('goal'), 'Новый проект с целью'));
  if (onAll) tools.append(button(`chip ${all ? 'on' : 'suggest'}`, 'Все', onAll, 'Показать завершённые и архивные проекты'));
  box.append(tools);
  return box;
}

// «Проект» in task details: the current project and section; a tap shows active projects, then that project's sections.
export function projectLine(task, { projects, save }) {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const project = task.project ? byId.get(task.project) : null;
  const section = project?.sections.find((item) => item.id === task.section);
  const box = element('div', 'details-project');
  const choice = element('div', 'chips');
  const label = project ? `▸ ${project.title}${section ? ` · ${section.title}` : ''}` : 'Входящие · без проекта';
  const sections = (target) => {
    choice.replaceChildren(...target.sections.map((item) => button(`chip ${task.project === target.id && task.section === item.id ? 'on' : 'suggest'}`, item.title,
      () => save({ op: 'update', project: target.id, section: item.id }))));
    if (!target.sections.length) save({ op: 'update', project: target.id, section: null });
  };
  box.append(button('link-button details-project-pick', label, () => {
    const active = projects.filter((item) => item.status === 'active' || item.id === task.project).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    choice.replaceChildren(...active.map((item) => button(`chip ${item.id === task.project ? 'on' : 'suggest'}`, item.title, () => (item.sections.length ? sections(item) : save({ op: 'update', project: item.id, section: null })))),
      ...(task.project ? [button('chip suggest', 'Без проекта', () => save({ op: 'update', project: null, section: null }))] : []));
    if (!active.length) choice.replaceChildren(element('p', 'drawer-empty', 'Проектов пока нет: создайте в левой панели «Задач».'));
  }, 'Проект задачи: сменить'), choice);
  return box;
}
