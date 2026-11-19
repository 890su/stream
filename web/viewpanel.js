// The left panel of «Задачи» as a control panel of the view (viewstate.js): three layouts over one view, switched by
// the gear at the bottom (⚙ and a list of three):
// - «Оси» — КОГДА · ЧЬЁ · ГДЕ (projects, counterparties, people) combine; «Мои виды» save a combination;
// - «Списки», as in TickTick — smart lists · projects · filters; a tap opens one list (the view is replaced);
// - «Дерево», as in Things — when on top, then areas → projects; people and counterparties by search.
// The current view in words with ✕ on top of every layout.
import { WHEN, WHOSE, applyView, countsFor, viewTitle, isDefaultView } from './viewstate.js';
import { LAYOUTS } from './viewstore.js';
import { projectTreeBlock } from './projectpanel.js';
import { isOpen } from './taskfold.js';

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
// A row of the panel: title, count, on when chosen.
function row(title, count, on, onClick) {
  const node = button(`drawer-contact${on ? ' on' : ''}`, '', onClick);
  node.setAttribute('aria-pressed', String(on));
  node.append(element('span', 'drawer-title', title), element('span', 'drawer-count', count ? String(count) : ''));
  if (!count) node.classList.add('empty-list');
  return node;
}

// ctx: { store (viewstore.js), tasks, projects, counterparties, people, onCreateProject, done() — closes the panel on a phone }
export function viewPanel(ctx) {
  const { store } = ctx;
  const view = store.get();
  const data = { now: new Date(), projects: ctx.projects, people: ctx.people };
  const box = element('div', 'view-panel');
  // «Оси» combine: a choice keeps the panel open; a list of «Списки» or «Дерево» opens and the panel closes.
  const set = (change) => store.set(change);
  const replace = (next) => { store.replace(next); ctx.done?.(); };

  // On top: the view in words, ✕ back to the pulse.
  const head = element('div', 'view-current');
  head.append(element('span', 'view-current-title', viewTitle(view, ctx)));
  if (!isDefaultView(view)) head.append(button('icon-button', '✕', () => replace({}), 'Сбросить вид: Пульт'));
  box.append(head);

  const layout = store.layout();
  if (layout === 'lists') box.append(...listsLayout(ctx, view, data, replace));
  else if (layout === 'tree') box.append(...treeLayout(ctx, view, data, replace, set));
  else box.append(...axesLayout(ctx, view, data, set, replace));

  // The gear at the bottom: which layout.
  const gear = element('label', 'view-gear');
  const select = element('select', 'view-gear-select');
  for (const item of LAYOUTS) select.append(Object.assign(document.createElement('option'), { value: item.id, textContent: item.title, selected: item.id === layout }));
  select.onchange = () => store.setLayout(select.value);
  gear.append(element('span', 'view-gear-icon', '⚙'), select);
  gear.title = 'Вид панели';
  box.append(gear);
  return box;
}

// Open tasks of a counterparty or a person, for their rows.
const openOf = (tasks, match) => tasks.filter((task) => isOpen(task) && !task.filed && match(task)).length;
const personMatch = (person) => (task) => Object.values(task.roles ?? {}).flat().some((party) => person.points.includes(party));
const busyCounterparties = (ctx) => ctx.counterparties.filter((item) => item.status === 'active')
  .map((item) => ({ item, open: openOf(ctx.tasks, (task) => task.counterparty === item.id) })).filter(({ open }) => open).sort((a, b) => b.open - a.open);
const busyPeople = (ctx) => ctx.people.filter((person) => person.status !== 'deleted' && person.points.length)
  .map((person) => ({ person, open: openOf(ctx.tasks, personMatch(person)) })).filter(({ open }) => open).sort((a, b) => b.open - a.open);

// «Оси»: КОГДА · ЧЬЁ chips with counts, ГДЕ — projects, counterparties, people; «Мои виды».
function axesLayout(ctx, view, data, set, replace) {
  const nodes = [];
  const chips = (axis, options) => {
    const counts = countsFor(ctx.tasks, view, axis, data);
    const wrap = element('div', 'chips view-axis');
    for (const option of options) {
      const on = view[axis] === option.id;
      const chip = button(`chip ${on ? 'on' : 'suggest'}`, `${option.icon ? `${option.icon} ` : ''}${option.title}${option.id !== 'pulse' && counts.get(option.id) ? ` ${counts.get(option.id)}` : ''}`, () => set({ [axis]: option.id }));
      chip.setAttribute('aria-pressed', String(on));
      wrap.append(chip);
    }
    return wrap;
  };
  nodes.push(element('h3', 'drawer-section', 'Когда'), chips('when', WHEN), element('h3', 'drawer-section', 'Чьё'), chips('whose', WHOSE));
  nodes.push(element('h3', 'drawer-section', 'Где · проекты'), projectTreeBlock({ projects: ctx.projects, tasks: ctx.tasks, current: view.where?.project ?? null,
    onOpen: (id) => set({ where: { project: view.where?.project === id ? null : id } }), onCreate: ctx.onCreateProject }));
  const counterparties = busyCounterparties(ctx);
  if (counterparties.length) {
    nodes.push(element('h3', 'drawer-section', 'Где · контрагенты'));
    for (const { item, open } of counterparties.slice(0, 8)) nodes.push(row(`◆ ${item.title}`, open, view.where?.counterparty === item.id, () => set({ where: { counterparty: view.where?.counterparty === item.id ? null : item.id } })));
  }
  const people = busyPeople(ctx);
  if (people.length) {
    nodes.push(element('h3', 'drawer-section', 'Где · люди'));
    for (const { person, open } of people.slice(0, 8)) nodes.push(row(person.name, open, view.where?.person === person.id, () => set({ where: { person: view.where?.person === person.id ? null : person.id } })));
  }
  nodes.push(...savedViews(ctx, view, replace, true));
  return nodes;
}

// «Мои виды»: saved combinations; «+ Сохранить текущий вид» names the current one.
function savedViews(ctx, view, replace, canSave) {
  const nodes = [element('h3', 'drawer-section', 'Мои виды ★')];
  for (const item of ctx.store.saved()) {
    const line = element('div', 'view-saved');
    const open = row(`★ ${item.title}`, applyView(ctx.tasks, item.view, { now: new Date(), projects: ctx.projects, people: ctx.people }).length, false, () => replace(item.view));
    line.append(open, button('icon-button', '×', () => { ctx.store.remove(item.id); ctx.store.set({}); }, `Удалить вид «${item.title}»`));
    nodes.push(line);
  }
  if (canSave && !isDefaultView(view)) {
    const form = element('form', 'view-save');
    const input = Object.assign(document.createElement('input'), { placeholder: 'Название вида', maxLength: 60, className: 'details-input' });
    input.setAttribute('aria-label', 'Название вида');
    form.append(input, button('chip suggest', '+ Сохранить вид', () => form.requestSubmit()));
    form.onsubmit = (event) => { event.preventDefault(); ctx.store.save(input.value || viewTitle(view, ctx)); ctx.store.set({}); };
    nodes.push(form);
  } else if (!ctx.store.saved().length) nodes.push(element('p', 'drawer-empty', 'Выберите когда, чьё и где — и сохраните сочетание.'));
  return nodes;
}

// «Списки», as in TickTick: smart lists · projects · filters; one tap — one list.
function listsLayout(ctx, view, data, replace) {
  const nodes = [element('h3', 'drawer-section', 'Умные списки')];
  const whenCounts = countsFor(ctx.tasks, { when: 'all', whose: 'all', where: {} }, 'when', data);
  const plain = (next) => view.when === next.when && view.whose === (next.whose ?? 'all') && JSON.stringify(view.where ?? {}) === JSON.stringify(next.where ?? {});
  for (const option of WHEN) nodes.push(row(`${option.icon} ${option.title}`, option.id === 'pulse' ? 0 : whenCounts.get(option.id), plain({ when: option.id }), () => replace({ when: option.id })));
  nodes.push(element('h3', 'drawer-section', 'Проекты'), projectTreeBlock({ projects: ctx.projects, tasks: ctx.tasks, current: view.where?.project ?? null,
    onOpen: (id) => replace({ when: 'all', where: { project: id } }), onCreate: ctx.onCreateProject }));
  nodes.push(element('h3', 'drawer-section', 'Фильтры'));
  const whoseCounts = countsFor(ctx.tasks, { when: 'all', whose: 'all', where: {} }, 'whose', data);
  for (const option of WHOSE.filter((item) => item.id !== 'all')) nodes.push(row(option.title, whoseCounts.get(option.id), plain({ when: 'all', whose: option.id }), () => replace({ when: 'all', whose: option.id })));
  for (const { item, open } of busyCounterparties(ctx).slice(0, 5)) nodes.push(row(`◆ ${item.title}`, open, plain({ when: 'all', where: { counterparty: item.id } }), () => replace({ when: 'all', where: { counterparty: item.id } })));
  nodes.push(...savedViews(ctx, view, replace, false));
  return nodes;
}

// «Дерево», as in Things: when on top, then areas → projects; people and counterparties by search.
function treeLayout(ctx, view, data, replace, set) {
  const nodes = [];
  const counts = countsFor(ctx.tasks, { when: 'all', whose: view.whose, where: {} }, 'when', data);
  const order = ['inbox', 'today', 'upcoming', 'all', 'deferred', 'done', 'unreported', 'pulse'];
  const names = { all: 'В любое время', deferred: 'Когда-нибудь', done: 'Журнал' };
  for (const id of order) {
    const option = WHEN.find((item) => item.id === id);
    nodes.push(row(`${option.icon} ${names[id] ?? option.title}`, id === 'pulse' ? 0 : counts.get(id), view.when === id && !view.where?.project, () => replace({ when: id, whose: view.whose })));
  }
  nodes.push(element('h3', 'drawer-section', 'Области и проекты'), projectTreeBlock({ projects: ctx.projects, tasks: ctx.tasks, current: view.where?.project ?? null,
    onOpen: (id) => replace({ when: 'all', whose: view.whose, where: { project: id } }), onCreate: ctx.onCreateProject }));
  // Search: a counterparty or a person by name.
  const search = Object.assign(document.createElement('input'), { type: 'search', placeholder: 'Найти контрагента или человека', className: 'details-input view-search' });
  search.setAttribute('aria-label', 'Найти контрагента или человека');
  const found = element('div', 'view-found');
  search.oninput = () => {
    const query = search.value.trim().toLowerCase();
    if (!query) { found.replaceChildren(); return; }
    const hits = [
      ...ctx.counterparties.filter((item) => item.status === 'active' && item.title.toLowerCase().includes(query)).slice(0, 5)
        .map((item) => row(`◆ ${item.title}`, openOf(ctx.tasks, (task) => task.counterparty === item.id), false, () => set({ when: 'all', where: { counterparty: item.id, person: null, project: null } }))),
      ...ctx.people.filter((person) => person.status !== 'deleted' && person.name.toLowerCase().includes(query)).slice(0, 5)
        .map((person) => row(person.name, openOf(ctx.tasks, personMatch(person)), false, () => set({ when: 'all', where: { person: person.id, counterparty: null, project: null } }))),
    ];
    found.replaceChildren(...(hits.length ? hits : [element('p', 'drawer-empty', 'Никого не нашлось')]));
  };
  nodes.push(element('h3', 'drawer-section', 'Люди и контрагенты'), search, found);
  return nodes;
}
