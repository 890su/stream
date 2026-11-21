// Renders the task card and its inline participant conversation.
import { checklistBlock } from './checklist.js';
import { projectLine } from './projectpanel.js';
import { personOf } from './contacts.js';
import { actionBar } from './taskbar.js';
import { contactLinks, section } from './taskcard.js';
import { counterpartyLine } from './counterpartyline.js';
import { taskParties, participantsBlock } from './participants.js';
import { partyName, PARTY_LABELS } from './parties.js';
import { STATUSES } from './taskfold.js';
import { dueChips } from './taskactions.js';
import { taskChips } from './taskchips.js';
import { partyConversation, cardOrder, pagerOrder, readOrder, talkPane, lastSpeaker, taskActivity, frontOrder } from './cardtalk.js';

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

// The description: the task's note; a tap edits it in place.
function descriptionBlock(task, save) {
  const text = button(`card-description${task.note ? '' : ' empty'}`, task.note || '+ описание', () => {
    const form = element('form', 'details-rename card-description-form');
    const input = Object.assign(document.createElement('textarea'), { value: task.note ?? '', maxLength: 1000, rows: 3 });
    input.setAttribute('aria-label', 'Описание задачи');
    form.append(input, button('link-button', 'Готово', () => form.requestSubmit()));
    form.onsubmit = (event) => {
      event.preventDefault();
      const next = input.value.trim();
      if (next !== (task.note ?? '')) save({ op: 'update', note: next });
      form.replaceWith(descriptionBlock({ ...task, note: next }, save));
    };
    text.replaceWith(form);
    input.focus();
  }, 'Изменить описание');
  return text;
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

export { personParty } from './parties.js'; // moved: the action bar types people in too (taskbar.js)

// A participant's name: the directory's, else their conversation's title, else as the messages say.
const namer = (directory, conversations, views) => (party) => directory?.people.find((person) => person.status !== 'deleted' && person.points.includes(party))?.name
  ?? (!Object.hasOwn(PARTY_LABELS, party) ? partyConversation(party, conversations)?.title : null) ?? partyName(party, views);

function peopleRows(task, { directory, conversations, views, save, onTalk, onAdd, talk }, groups, order, selected) {
  const node = element('div', 'task-people');
  const options = { strip: true, views, nameOf: namer(directory, conversations, views), people: directory?.people ?? [],
    save, savePerson: directory?.savePerson };
  const select = (parties) => ({ order: parties, selected, onSelect: onTalk });
  if (!selected || groups.internal.includes(selected)) {
    const internal = participantsBlock(task, { ...options, hideAdd: true, compactRoles: true, menuGroup: 'internal', select: select(groups.internal) });
    internal.classList.add('task-internal-people');
    node.append(internal);
  }
  // The chosen tile goes leftmost — after a swipe only once the owner types (cardtalk.js frontOrder, details.js).
  const front = frontOrder(order, selected, !talk?.swiped);
  const external = participantsBlock(task, { ...options, onAdd, menuGroup: 'chat', emptyLabel: 'Нет собеседников', select: select(front) });
  external.classList.add('task-external-people');
  const toggle = button('icon-button card-talk-open', '', () => onTalk(null), selected ? 'Свернуть переписку' : 'Беседы задачи');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 3V7a2 2 0 0 1 1-2Z"/><path d="M8 10h8m-8 3h5"/></svg>';
  toggle.setAttribute('aria-expanded', String(Boolean(selected)));
  external.querySelector('.people-row').prepend(toggle);
  node.append(external);
  return node;
}

export function taskDetails(task, ctx) {
  const { views, save, saveTo, notify, projects, doneCards, fields, cardSettings, directory, bar,
    conversations, onDone, onExpand, onConversation, talk, bubble, redraw, now = new Date() } = ctx;
  const box = element('div', 'details-task');
  const groups = taskParties(task, views);
  const recent = cardOrder(groups.external, { stored: readOrder(task.id), lastAuthor: lastSpeaker(views, groups.external, task.muted ?? []) });
  const order = pagerOrder(recent, talk?.order);
  const selected = !talk ? null : [...groups.internal, ...groups.external].includes(talk.party) ? talk.party
    : recent.find((party) => !(task.muted ?? []).includes(party)) ?? recent[0] ?? 'me';
  const people = peopleRows(task, ctx, groups, recent, selected);
  if (bar && !selected) {
    const actions = element('div', 'card-bar');
    actions.append(actionBar(task, bar));
    box.append(actions);
  }
  // ○ and the title: the round mark closes the task (and takes back a closed one), like every task manager.
  const head = element('div', 'card-title-row');
  const closed = ['done', 'cancelled'].includes(task.status);
  const mark = button(`task-check icon-button card-done${closed ? ' checked' : ''}`, '', onDone, closed ? 'Вернуть в работу' : task.status === 'review' ? 'Проверил' : 'Готово');
  mark.append(element('span', 'task-check-ring'));
  head.append(mark, selected
    ? button('details-title card-expand', task.title, onExpand, `Развернуть карточку: ${task.title}`) : titleBlock(task, save));

  if (selected) {
    const sticky = element('div', 'task-chat-head');
    sticky.append(head, people);
    const conversation = Object.hasOwn(PARTY_LABELS, selected) ? null : partyConversation(selected, conversations);
    box.append(sticky, talkPane({ task, party: selected, conversation, taskViews: views, tasksById: ctx.tasksById, bubble, name: namer(directory, conversations, views)(selected),
      log: taskActivity(task), unlink: (id) => save({ op: 'update', remove: [id] }), onMode: redraw }));
    onConversation((task.muted ?? []).includes(selected) || selected.startsWith('name:') ? null : conversation);
    return { node: box, order, selected };
  }
  onConversation(null);
  box.append(head);
  if (task.status !== 'todo') box.append(element('p', 'card-headline', STATUSES[task.status]));
  if (task.resumeNote && task.resumeNote !== 'в работе') box.append(element('p', 'card-next', `дальше: ${task.resumeNote}`));

  // The chips: when, due, project, counterparty, repeat.
  const counterparty = task.counterparty ? directory?.counterparties.find((item) => item.id === task.counterparty) : null;
  const counterpartyChip = counterparty ? button('chip suggest task-chip', `${counterparty.kind === 'address' ? '⌂' : '◆'} ${counterparty.title}`, () => directory?.onOpen?.(counterparty.id), 'Карточка контрагента') : null;
  box.append(taskChips(task, { save, now, dueChips, settings: cardSettings, project: projectLine(task, { projects, save }), counterparty: counterpartyChip }));
  box.append(descriptionBlock(task, save));
  const card = doneCards.card(task);
  if (card) box.append(card);

  // A call and a map in one tap: the author from the directory, the counterparty's address.
  if (directory) {
    const person = task.roles?.author ? personOf(task.roles.author, directory.people) : null;
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

  // The checklist, open: items, ticks, «+ пункт».
  const checklist = checklistBlock(task, { save, saveTo, notify });
  if (checklist) box.append(checklist);

  box.append(people);

  // «Подробности», folded: how it was made, the report of a closed task. The changes are in «Я» of the conversations.
  const more = [];
  if (directory && !task.filed) more.push(counterpartyLine(task, { ...directory, save }));
  const createdBy = { me: 'создано вами', system: 'создано автоматически' };
  const origin = createdBy[task.createdBy] ?? `создано разбором${task.confidence !== undefined ? ` · уверенность ${Math.round(task.confidence * 100)}%` : ''}`;
  more.push(element('p', 'details-meta', `${origin} · ${clock.format(new Date(task.createdAt))}`));
  if (task.report && task.status === 'done') {
    more.push(element('p', 'picker-section', 'Отчёт'), reportBlock(task.report, fields));
    if (task.report.missing?.length && !card) more.push(button('link-button', 'Заполнить отчёт', () => doneCards.start(task)));
  }
  box.append(section('more', 'Подробности', more));
  return { node: box, order, selected };
}
