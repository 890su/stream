// The task card in the right panel (task card design §4): the title, «контрагент · срок · статус», «дальше», «Задача
// выполнена?», a call and a map; then folding sections — checklist, conversation (the last three), details (project,
// counterparty, roles, origin), report, history; the action bar (taskbar.js) always at the bottom.
import { STATUSES, describeChange } from './taskfold.js';
import { partyName } from './parties.js';
import { checklistBlock } from './checklist.js';
import { projectLine } from './projectpanel.js';
import { counterpartyLine } from './counterpartyline.js';
import { personOf } from './contacts.js';
import { actionBar } from './taskbar.js';
import { headline, nextStep, contactLinks, section } from './taskcard.js';

const clock = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

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

function titleBlock(task, save) {
  const title = button('details-title', task.title, () => {
    const form = element('form', 'details-rename');
    const input = Object.assign(document.createElement('input'), { value: task.title, maxLength: 200, enterKeyHint: 'done' });
    input.setAttribute('aria-label', 'Название задачи');
    form.append(input, button('link-button', 'Готово', () => form.requestSubmit()));
    form.onsubmit = (event) => {
      event.preventDefault();
      const next = input.value.trim();
      if (next && next !== task.title) save({ op: 'update', title: next });
      form.replaceWith(titleBlock({ ...task, title: next || task.title }, save));
    };
    title.replaceWith(form);
    input.focus();
    input.select();
  }, 'Переименовать задачу');
  return title;
}

function reportBlock(report, fields) {
  const box = element('div', 'details-report');
  for (const [key, value] of Object.entries(report)) {
    if (key === 'missing' || key === 'currency' || !fields[key]) continue;
    const shown = fields[key].type === 'money' ? `${value} ${report.currency ?? ''}`.trim()
      : fields[key].type === 'datetime' ? clock.format(new Date(value)) : Array.isArray(value) ? value.join(' ') : String(value);
    box.append(element('div', 'details-fact', `${fields[key].title}: ${shown}`));
  }
  if (report.missing?.length) box.append(element('div', 'details-fact muted', `Не заполнено: ${report.missing.map((key) => fields[key]?.title ?? key).join(', ')}`));
  return box;
}

// Roles: folded into one line — who does it, else who answers for it; unfolded — every filled role.
function rolesBlock(task, views) {
  const { roles } = task;
  const lines = [['Исполнитель', roles.executors], ['Ответственный', [roles.responsible]], ['Контролёр', [roles.controller]], ['Постановщик', [roles.author]], ['Ждём', [task.waitingFor?.party]]]
    .map(([label, parties]) => [label, parties.filter(Boolean).map((party) => partyName(party, views))]).filter(([, names]) => names.length);
  if (!lines.length) return null;
  const box = element('details', 'details-roles');
  const [label, names] = lines[0];
  box.append(element('summary', 'details-fact', `${label} · ${names.join(', ')}${lines.length > 1 ? ' · ещё роли' : ''}`));
  for (const [line, people] of lines.slice(1)) box.append(element('div', 'details-fact', `${line} · ${people.join(', ')}`));
  return box;
}

export { personParty } from './parties.js'; // moved: the action bar types people in too (taskbar.js)

// `ctx`: { views (the task's messages), bubble(view), save(change), saveTo(id, change), others (open tasks), notify,
// doneCards, projects, reportKeys, fields, directory (contacts), bar (the action bar's context, tasksheet.js barContext) }.
export function taskDetails(task, { views, bubble, save, saveTo, others, notify, projects = [], doneCards, fields, directory = null, bar = null, now = new Date() }) {
  const box = element('div', 'details-task');
  // The top: what it is, with whom, when, the state, what next — the five seconds (task manager spec §2).
  box.append(titleBlock(task, save));
  const line = headline(task, now);
  if (line.length) box.append(element('p', 'card-headline', line.join(' · ')));
  const next = nextStep(task);
  if (next) box.append(element('p', 'card-next', `дальше: ${next}`));
  const card = doneCards.card(task);
  if (card) box.append(card);

  // A call and a map in one tap: the author from the directory, the counterparty's address.
  if (directory) {
    const person = task.roles?.author ? personOf(task.roles.author, directory.people) : null;
    const counterparty = task.counterparty ? directory.counterparties.find((item) => item.id === task.counterparty) : null;
    const links = contactLinks({ person, counterparty });
    if (links.length) {
      const contacts = element('div', 'card-contacts');
      for (const link of links) {
        const node = Object.assign(document.createElement('a'), { className: `chip suggest card-contact ${link.kind}`, href: link.href, textContent: `${link.kind === 'tel' ? '📞' : '📍'} ${link.text}` });
        if (link.kind === 'map') { node.target = '_blank'; node.rel = 'noopener'; }
        contacts.append(node);
      }
      box.append(contacts);
    }
  }

  // A checklist with items is shown as it is (it has its own head); an empty one waits in «Подробности».
  const checklist = checklistBlock(task, { save, saveTo, others, notify });
  if (checklist && task.items?.length) box.append(checklist);

  // The conversation: the last three, «Показать все» for the rest.
  const talk = element('div', 'details-talk');
  const message = (view) => {
    const item = element('div', 'details-message');
    item.append(bubble(view));
    if (task.messages.includes(view.id)) item.append(button('icon-button details-unlink', '×', (event) => { event.stopPropagation(); save({ op: 'update', remove: [view.id] }); }, 'Убрать сообщение из задачи'));
    return item;
  };
  talk.append(...views.slice(-3).map(message));
  if (views.length > 3) {
    const more = button('link-button', `Показать все · ${views.length}`, () => { more.remove(); talk.replaceChildren(...views.map(message)); });
    talk.prepend(more);
  }
  if (!views.length) talk.append(element('p', 'drawer-empty', 'Сообщений нет'));
  box.append(section('talk', `Переписка · ${views.length}`, [talk], { open: true }));

  // Details: project, counterparty, roles, how it was made; open while the triage asks something here.
  const asks = (!task.project && task.project_options?.length) || (!task.counterparty && (task.counterparty_options?.length || task.counterparty_hint));
  const more = [projectLine(task, { projects, save })];
  if (checklist && !task.items?.length) more.push(checklist);
  if (directory && !task.filed) more.push(counterpartyLine(task, { ...directory, save }));
  const roles = rolesBlock(task, views);
  if (roles) more.push(roles);
  const origin = task.createdBy === 'me' ? 'создано вами' : `создано разбором${task.confidence !== undefined ? ` · уверенность ${Math.round(task.confidence * 100)}%` : ''}`;
  more.push(element('p', 'details-meta', `${origin} · ${clock.format(new Date(task.createdAt))}`));
  if (task.note) more.push(element('p', 'details-meta', task.note));
  box.append(section('more', 'Подробности', more, { force: asks ? true : null }));

  // A report belongs to a closed task; a task taken back into work («Вернуть») keeps it in the journal only.
  if (task.report && task.status === 'done') {
    const report = [reportBlock(task.report, fields)];
    if (task.report.missing?.length && !card) report.push(button('link-button', 'Заполнить отчёт', () => doneCards.start(task)));
    box.append(section('report', 'Отчёт', report, { open: true }));
  }

  const history = [...(task.history ?? [])].reverse().map((item) => {
    const who = item.author === 'me' ? 'вы' : item.change?.processor ? 'разбор' : 'система';
    return element('div', 'details-fact', `${clock.format(new Date(item.ts))} · ${who} · ${describeChange(item.change ?? {})}`);
  });
  box.append(section('history', `История · ${history.length}`, history));

  // The same six icons as the long-press sheet, always at the bottom (task card design §3).
  if (bar) {
    const foot = element('div', 'card-bar');
    foot.append(actionBar(task, bar));
    box.append(foot);
  }
  return box;
}
