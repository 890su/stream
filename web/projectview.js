// One project in the «Задачи» view (CONCEPT.md §2.11): a header (title, kind, status, «Изменить», ×) with the next
// action warning, and a head per section with «+» to add a task right there. The project's own sections come from
// projects.js; every change goes through `actions` (feed → app: saving project and task changes).
import { KINDS, PROJECT_STATUSES, projectSections } from './projects.js';
import { isOpen } from './taskfold.js';

export { projectSections };

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

const line = (text, max) => text.replace(/\s+/g, ' ').trim().slice(0, max);

// An inline one-line form: `onSubmit(text)`; Escape or an empty submit closes it.
export function inlineForm(placeholder, onSubmit, { value = '', max = 200 } = {}) {
  const form = element('form', 'project-form');
  const input = Object.assign(document.createElement('input'), { value, placeholder, maxLength: max, enterKeyHint: 'done' });
  input.setAttribute('aria-label', placeholder);
  form.append(input, button('link-button', 'Готово', () => form.requestSubmit()));
  form.onsubmit = (event) => { event.preventDefault(); const text = line(input.value, max); form.remove(); if (text) onSubmit(text); };
  input.addEventListener('keydown', (event) => { if (event.key === 'Escape') form.remove(); });
  requestAnimationFrame(() => input.focus());
  return form;
}

// actions: { saveProject(change), addTask(title, section), leave() }
export function projectHead(project, tasks, actions) {
  const box = element('div', 'project-head');
  const top = element('div', 'project-top');
  top.append(element('h2', 'project-title', project.title), button('icon-button', '×', actions.leave, 'Закрыть проект'));
  const open = tasks.filter((task) => isOpen(task)).length;
  box.append(top, element('p', 'project-meta', `${KINDS[project.kind] ?? project.kind} · ${PROJECT_STATUSES[project.status] ?? project.status} · открыто ${open}`));

  // A goal needs a next step: say so when the «next» section is empty (CONCEPT.md §2.11).
  const next = project.sections.find((section) => section.role === 'next');
  if (project.kind === 'goal' && project.status === 'active' && next && !tasks.some((task) => task.section === next.id && isOpen(task))) {
    const warn = element('div', 'project-warn');
    warn.append(element('span', '', `Нет следующего шага. Добавьте его в «${next.title}» или перенесите туда задачу.`),
      button('link-button', '+ Шаг', () => warn.append(inlineForm('Следующий шаг', (title) => actions.addTask(title, next.id)))));
    box.append(warn);
  }

  const edit = element('div', 'project-edit');
  edit.hidden = true;
  const chips = (values, current, key) => {
    const row = element('div', 'chips');
    for (const [value, title] of Object.entries(values)) {
      const chip = button(`chip ${value === current ? 'on' : 'suggest'}`, title, () => actions.saveProject({ [key]: value }));
      chip.setAttribute('aria-pressed', String(value === current));
      row.append(chip);
    }
    return row;
  };
  edit.append(
    button('link-button', 'Переименовать', () => edit.append(inlineForm('Название проекта', (title) => actions.saveProject({ title }), { value: project.title, max: 120 }))),
    chips(PROJECT_STATUSES, project.status, 'status'), chips(KINDS, project.kind, 'kind'),
    button('link-button', '+ Раздел', () => edit.append(inlineForm('Название раздела', (title) => actions.saveProject({ sections: [...project.sections, { id: crypto.randomUUID().slice(0, 8), title: line(title, 60) }] }), { max: 60 }))),
  );
  box.append(button('link-button project-edit-toggle', 'Изменить', () => { edit.hidden = !edit.hidden; }), edit);
  return box;
}

// A section head: title and count, «+» adds a task in it; a section can be renamed or removed in place.
export function projectSectionHead(section, project, actions) {
  const head = element('div', `task-section project-section${section.role ? ` ${section.role}` : ''}`);
  head.append(element('span', 'task-section-title', section.title), element('span', 'task-section-count', String(section.tasks.length)));
  const tools = element('span', 'project-section-tools');
  tools.append(button('icon-button', '+', () => head.after(inlineForm(`Задача в «${section.title}»`, (title) => actions.addTask(title, section.id === 'loose' ? null : section.id))), `Задача в «${section.title}»`));
  if (section.id !== 'loose') {
    tools.append(button('icon-button', '✎', () => head.after(inlineForm('Название раздела', (title) => actions.saveProject({ sections: project.sections.map((item) => (item.id === section.id ? { ...item, title: line(title, 60) } : item)) }), { value: section.title, max: 60 })), `Переименовать «${section.title}»`));
    if (!section.tasks.length) tools.append(button('icon-button', '−', () => actions.saveProject({ sections: project.sections.filter((item) => item.id !== section.id) }), `Убрать пустой раздел «${section.title}»`));
  }
  head.append(tools);
  return head;
}
