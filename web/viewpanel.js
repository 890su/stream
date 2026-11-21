// Renders task shortcuts and optional filters in the left panel.
import { PANEL_FILTERS, WHEN, WHOSE, applyView, countsFor, viewTitle, isDefaultView } from './viewstate.js';
import { projectTreeBlock } from './projectpanel.js';

export function taskShortcuts(tasks, data) {
  return PANEL_FILTERS.map(({ title, view }) => ({ view, title, count: applyView(tasks, view, data).length }));
}

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

function row(title, count, on, onClick) {
  const node = button(`drawer-contact view-row${on ? ' on' : ''}`, '', onClick);
  node.setAttribute('aria-pressed', String(on));
  node.append(element('span', 'drawer-title', title));
  if (count) node.append(element('span', 'drawer-count', String(count)));
  return node;
}

function section(key, title, expanded, active, ...children) {
  const details = element('details', 'drawer-disclosure');
  details.open = expanded.get(key) ?? active;
  details.addEventListener('toggle', () => { if (details.isConnected) expanded.set(key, details.open); });
  const body = element('div', 'view-options');
  body.append(...children);
  details.append(element('summary', 'drawer-summary', title), body);
  return details;
}

export function viewPanel(ctx) {
  const { store, tasks, projects, people, expanded, done } = ctx;
  const view = store.get();
  const data = { now: new Date(), projects, people };
  const box = element('div', 'view-panel');
  const open = (next) => { store.replace(next); done(); };
  const set = (change) => store.set(change);

  const shortcuts = taskShortcuts(tasks, data);
  const located = Object.values(view.where ?? {}).some(Boolean);
  const simple = !located && shortcuts.some(({ view: next }) => next.when === view.when && next.whose === view.whose);
  for (const item of shortcuts) {
    const on = ctx.inTasks && simple && item.view.when === view.when && item.view.whose === view.whose;
    box.append(row(item.title, item.count, on, () => open(item.view)));
  }
  if (!simple) box.append(element('div', 'view-scope', viewTitle(view, ctx)));

  const project = view.where?.project;
  const tree = projectTreeBlock({ projects, tasks, current: project, onCreate: ctx.onCreateProject,
    onOpen: (id) => open({ when: 'all', whose: 'all', where: { project: id } }) });
  box.append(section('projects', 'Проекты', expanded, Boolean(project), tree));

  const chips = (axis, options) => {
    const counts = countsFor(tasks, view, axis, data);
    const wrap = element('div', 'chips view-axis');
    for (const option of options) {
      const on = view[axis] === option.id;
      const count = counts.get(option.id);
      const chip = button(`chip ${on ? 'on' : 'suggest'}`, `${option.title}${count ? ` ${count}` : ''}`, () => set({ [axis]: option.id }));
      chip.setAttribute('aria-pressed', String(on));
      wrap.append(chip);
    }
    return wrap;
  };
  const options = [
    element('h3', 'drawer-section', 'Срок и состояние'), chips('when', WHEN),
    element('h3', 'drawer-section', 'Роль'), chips('whose', WHOSE),
    directorySearch(ctx, view, data, set),
    ...savedViews(ctx, view, data, open),
  ];
  if (ctx.showApply) options.push(button('chip on view-apply', 'Показать задачи', done));
  box.append(section('filters', 'Ещё фильтры', expanded, !simple && !project, ...options.filter(Boolean)));
  return box;
}

function directorySearch(ctx, view, data, set) {
  const people = ctx.people.filter((person) => person.status !== 'deleted' && person.points.length);
  const counterparties = ctx.counterparties.filter((item) => item.status === 'active');
  if (!people.length && !counterparties.length) return null;
  const box = element('div', 'view-directory');
  const search = element('input', 'details-input view-search');
  search.type = 'search';
  search.placeholder = 'Найти по имени или названию';
  search.setAttribute('aria-label', 'Люди и контрагенты');
  const found = element('div', 'view-found');
  search.oninput = () => {
    const query = search.value.trim().toLowerCase();
    if (!query) { found.replaceChildren(); return; }
    const matches = (items, name, key) => items.filter((item) => name(item).toLowerCase().includes(query)).slice(0, 5).map((item) => {
      const other = key === 'person' ? 'counterparty' : 'person';
      const on = view.where[key] === item.id;
      const where = { [key]: on ? null : item.id, [other]: null };
      const count = applyView(ctx.tasks, { ...view, when: view.when,
        where: { ...view.where, [key]: item.id, [other]: null } }, data).length;
      return row(name(item), count, on, () => { set({ where }); ctx.done(); });
    });
    const hits = [...matches(people, (item) => item.name, 'person'), ...matches(counterparties, (item) => item.title, 'counterparty')];
    found.replaceChildren(...(hits.length ? hits : [element('p', 'drawer-empty', 'Ничего не найдено')]));
  };
  box.append(element('h3', 'drawer-section', 'Люди и контрагенты'), search, found);
  return box;
}

function savedViews(ctx, view, data, open) {
  const nodes = [];
  const saved = ctx.store.saved();
  if (saved.length || !isDefaultView(view)) nodes.push(element('h3', 'drawer-section', 'Мои виды'));
  for (const item of saved) {
    const line = element('div', 'view-saved');
    line.append(row(item.title, applyView(ctx.tasks, item.view, data).length, false, () => open(item.view)),
      button('icon-button', '×', () => { ctx.store.remove(item.id); ctx.store.set({}); }, `Удалить вид «${item.title}»`));
    nodes.push(line);
  }
  if (!isDefaultView(view)) {
    const form = element('form', 'view-save');
    const input = Object.assign(document.createElement('input'), { placeholder: 'Название вида', maxLength: 60, className: 'details-input view-search' });
    input.setAttribute('aria-label', 'Название вида');
    form.append(input, button('chip suggest', 'Сохранить', () => form.requestSubmit()));
    form.onsubmit = (event) => { event.preventDefault(); ctx.store.save(input.value || viewTitle(view, ctx)); ctx.store.set({}); };
    nodes.push(form);
  }
  return nodes;
}
