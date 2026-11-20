// The task card on the main screen (owner, 2026-11-20, after reviewing task managers): ○ and the title; chips — when I
// do it, the due date, the project, the counterparty, the repeat (taskchips.js); the description (the task's note);
// the checklist, open; the participants line with «💬» on the left — the conversations of the task in a window of
// their own (taskTalk), a tap on a name opens that one; «Подробности» folded (how it was made, the report). Rarer
// actions are under ⋯ in the screen's head (the action bar, taskbar.js).
import { checklistBlock } from './checklist.js';
import { projectLine } from './projectpanel.js';
import { personOf } from './contacts.js';
import { actionBar } from './taskbar.js';
import { contactLinks, section } from './taskcard.js';
import { counterpartyLine } from './counterpartyline.js';
import { participants, participantsBlock } from './participants.js';
import { partyName } from './parties.js';
import { describeChange, STATUSES } from './taskfold.js';
import { dueChips } from './taskactions.js';
import { taskChips } from './taskchips.js';
import { partyConversation, cardOrder, pagerOrder, readOrder, talkPane, lastSpeaker } from './cardtalk.js';

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
  ?? (party !== 'me' ? partyConversation(party, conversations)?.title : null) ?? partyName(party, views);

// The participants in the order of the line: the recent ones first, at first whoever wrote last.
function talkOrder(task, views) {
  const parties = [...new Set(['me', ...participants(task).map((item) => item.party)])];
  return cardOrder(parties, { stored: readOrder(task.id), lastAuthor: lastSpeaker(views, parties, task.muted ?? []) });
}

// `ctx`: { views (the task's messages), save(change), saveTo(id, change), others (open tasks), notify, doneCards,
// projects, fields, directory (contacts), bar (the action bar's context), showBar (⋯ open), conversations,
// onDone(), onTalk(party) — open the conversations at that participant (null — the first) }.
export function taskDetails(task, { views, save, saveTo, others, notify, projects = [], doneCards, fields, cardSettings, directory = null, bar = null, showBar = false,
  conversations = [], onDone = () => {}, onTalk = () => {}, now = new Date() }) {
  const box = element('div', 'details-task');
  if (bar && showBar) {
    const actions = element('div', 'card-bar');
    actions.append(actionBar(task, bar));
    box.append(actions);
  }
  // ○ and the title: the round mark closes the task (and takes back a closed one), like every task manager.
  const head = element('div', 'card-title-row');
  const closed = ['done', 'cancelled'].includes(task.status);
  const mark = button(`task-check icon-button card-done${closed ? ' checked' : ''}`, '', onDone, closed ? 'Вернуть в работу' : task.status === 'review' ? 'Проверил' : 'Готово');
  mark.append(element('span', 'task-check-ring'));
  head.append(mark, titleBlock(task, save));
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
  const checklist = checklistBlock(task, { save, saveTo, others, notify });
  if (checklist) box.append(checklist);

  // The participants line: «💬» on the left opens the conversations of the task; a name opens that participant's.
  const order = talkOrder(task, views);
  const people = participantsBlock(task, { strip: true, views, nameOf: namer(directory, conversations, views), people: directory?.people ?? [],
    save, savePerson: directory?.savePerson,
    select: { order, selected: null, onSelect: (party) => onTalk(party) } });
  people.querySelector('.people-row')?.prepend(button('card-talk-open', '💬', () => onTalk(null), 'Беседы задачи'));
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
  return box;
}

// The conversations of the task, one participant at a time (owner, 2026-11-20): the participants line (the chosen one
// leftmost with 📣), ‹ n из N › to move, and the conversation. ctx: { views, bubble, save, conversations, directory,
// party (the chosen one), onSelect(party, dir), redraw(), onConversation(conversation | null) }.
export function taskTalk(task, { views, bubble, save, conversations = [], directory = null, party, previousOrder, onSelect, redraw, onConversation = () => {} }) {
  const box = element('div', 'task-talk');
  const order = pagerOrder(talkOrder(task, views), previousOrder);
  const selected = order.includes(party) ? party : order[0] ?? 'me';
  const index = order.indexOf(selected);
  const nameOf = namer(directory, conversations, views);
  box.append(participantsBlock(task, { strip: true, views, nameOf, people: directory?.people ?? [], counterparties: directory?.counterparties ?? null,
    save, savePerson: directory?.savePerson, saveCounterparty: directory?.saveCounterparty, onOpenCounterparty: directory?.onOpen,
    select: { order: [selected, ...order.filter((item) => item !== selected)], selected, onSelect } }));
  if (order.length > 1) {
    const nav = element('div', 'task-talk-nav');
    const go = (step) => onSelect(order[(index + step + order.length) % order.length], step > 0 ? 'next' : 'prev');
    nav.append(button('icon-button', '‹', () => go(-1), 'Предыдущая беседа'), element('span', 'task-talk-where', `${index + 1} из ${order.length}`), button('icon-button', '›', () => go(1), 'Следующая беседа'));
    box.append(nav);
  }
  const conversation = selected === 'me' ? null : partyConversation(selected, conversations);
  const log = (task.history ?? []).map((item) => ({ ts: item.ts, text: `${item.author === 'me' ? 'вы' : item.change?.processor ? 'разбор' : 'система'}: ${describeChange(item.change ?? {})}` }));
  const pane = talkPane({ task, party: selected, conversation, taskViews: views, bubble, name: nameOf(selected), log,
    unlink: (id) => save({ op: 'update', remove: [id] }), onMode: redraw });
  box.append(pane);
  // A switched-off participant gets no answer from the task: the message stays a note (PLAN 2026-11-20).
  onConversation((task.muted ?? []).includes(selected) ? null : conversation);
  return { node: box, order, selected };
}
