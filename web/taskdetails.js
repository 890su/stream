// The task card (owner, 2026-11-22): it reads like a conversation — the title, the line of dates and the counterparty
// and the cuts «Описание · Чеклист · Подробности» on top, the conversation with the chosen interlocutor (or the task's
// comments) under them, the interlocutors at the bottom.
import { checklistBlock } from './checklist.js';
import { projectLine } from './projectpanel.js';
import { personOf } from './contacts.js';
import { actionBar } from './taskbar.js';
import { contactLinks } from './taskcard.js';
import { counterpartyLine } from './counterpartyline.js';
import { taskParties, participantsBlock } from './participants.js';
import { partyName, PARTY_LABELS } from './parties.js';
import { STATUSES } from './taskfold.js';
import { dueChips } from './taskactions.js';
import { taskChips } from './taskchips.js';
import { partyConversation, cardOrder, pagerOrder, readOrder, talkPane, lastSpeaker, taskActivity, frontOrder, pickParty, messageParties } from './cardtalk.js';

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

// The interlocutors at the bottom, as over the input of a conversation: a tap chooses whose conversation shows and
// gets the reply, a tap on the chosen one switches it off — then the card shows the task's comments and the input
// writes there; the icon edits roles, «+» adds one.
function peopleStrip(task, { directory, conversations, views, save, onTalk, onAdd, talk }, groups, order, selected) {
  const node = element('div', 'task-people task-people-bottom');
  // The chosen tile goes leftmost — after a swipe only once the owner types (cardtalk.js frontOrder, details.js).
  const front = frontOrder(order, selected, !talk?.swiped);
  const external = participantsBlock(task, { strip: true, views, nameOf: namer(directory, conversations, views), people: directory?.people ?? [],
    save, savePerson: directory?.savePerson, onAdd, menuGroup: 'chat', emptyLabel: 'Нет собеседников — записи идут в комментарии',
    select: { order: front, selected, onSelect: onTalk } });
  external.classList.add('task-external-people');
  node.append(external);
  return node;
}

// Я, ИИ, Система and their roles — in «Подробности».
function internalPeople(task, { directory, conversations, views, save }, groups) {
  const block = participantsBlock(task, { strip: true, views, nameOf: namer(directory, conversations, views), people: directory?.people ?? [],
    save, savePerson: directory?.savePerson, hideAdd: true, compactRoles: true, menuGroup: 'internal', select: { order: groups.internal, selected: null, onSelect: () => {} } });
  block.classList.add('task-internal-people');
  return block;
}

// The cuts of the card (owner, 2026-11-22): «Описание», «Чеклист», «Подробности» — one open at a time; 💬 folds them
// and shows the conversation. `fold` — the open one's key or null.
function cutsRow(cuts, fold, onFold, onShowTalk) {
  const row = element('div', 'card-cuts');
  for (const cut of cuts) {
    const on = fold === cut.key;
    const node = button(`card-cut${on ? ' open' : ''}`, cut.title, () => onFold(cut.key));
    node.setAttribute('aria-expanded', String(on));
    row.append(node);
  }
  const talk = button('icon-button card-talk-open', '', onShowTalk, 'Беседа');
  talk.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 3V7a2 2 0 0 1 1-2Z"/><path d="M8 10h8m-8 3h5"/></svg>';
  talk.setAttribute('aria-expanded', String(!fold));
  row.append(talk);
  return row;
}

// The task card (owner, 2026-11-22): like a conversation — on top the title, the line of dates and the counterparty
// and the cuts; under them the conversation with the chosen interlocutor (or the task's comments); the interlocutors
// at the bottom. ctx.talk — { party (undefined — not chosen yet, null — the comments), swiped }; ctx.fold — the open
// cut; onFold(key), onShowTalk(), onTalk(party).
export function taskDetails(original, ctx) {
  let task = original;
  const { views, save, saveTo, notify, projects, doneCards, fields, cardSettings, directory, bar,
    conversations, onDone, onConversation, talk, bubble, redraw, fold = null, onFold = () => {}, onShowTalk = () => {}, now = new Date() } = ctx;
  const box = element('div', 'details-task card-as-chat');
  // The people of the task's conversations join its tiles as plain members (a role or a mute saves them for good).
  const roled = taskParties(task, views);
  const extra = messageParties(task, conversations).filter((party) => !roled.external.includes(party));
  if (extra.length) task = { ...task, roles: { ...task.roles, members: [...(task.roles?.members ?? []), ...extra] } };
  const groups = extra.length ? taskParties(task, views) : roled;
  const muted = task.muted ?? [];
  const recent = cardOrder(groups.external, { stored: readOrder(task.id), lastAuthor: lastSpeaker(views, groups.external, muted) });
  const order = pagerOrder(recent, talk?.order);
  const selected = pickParty(talk?.party, groups.external, recent, muted);

  const head = element('div', 'task-chat-head');
  if (bar) {
    const actions = element('div', 'card-bar');
    actions.append(actionBar(task, bar));
    head.append(actions);
  }
  // ○ and the title: the round mark closes the task (and takes back a closed one), like every task manager.
  const titleRow = element('div', 'card-title-row');
  const closed = ['done', 'cancelled'].includes(task.status);
  const mark = button(`task-check icon-button card-done${closed ? ' checked' : ''}`, '', onDone, closed ? 'Вернуть в работу' : task.status === 'review' ? 'Проверил' : 'Готово');
  mark.append(element('span', 'task-check-ring'));
  titleRow.append(mark, titleBlock(task, save));
  head.append(titleRow);
  if (task.status !== 'todo') head.append(element('p', 'card-headline', STATUSES[task.status]));
  if (task.resumeNote && task.resumeNote !== 'в работе') head.append(element('p', 'card-next', `дальше: ${task.resumeNote}`));

  // The line of dates and the counterparty: when, due, project, counterparty, repeat.
  const counterparty = task.counterparty ? directory?.counterparties.find((item) => item.id === task.counterparty) : null;
  const counterpartyChip = counterparty ? button('chip suggest task-chip', `${counterparty.kind === 'address' ? '⌂' : '◆'} ${counterparty.title}`, () => directory?.onOpen?.(counterparty.id), 'Карточка контрагента') : null;
  head.append(taskChips(task, { save, now, dueChips, settings: cardSettings, project: projectLine(task, { projects, save }), counterparty: counterpartyChip }));
  const card = doneCards.card(task);
  if (card) head.append(card);

  // The cuts.
  const description = () => {
    const nodes = [descriptionBlock(task, save)];
    // A call and a map in one tap: the author from the directory, the counterparty's address.
    const person = directory && task.roles?.author ? personOf(task.roles.author, directory.people) : null;
    const links = directory ? contactLinks({ person, counterparty }) : [];
    if (links.length) {
      const contacts = element('div', 'card-contacts');
      for (const link of links) {
        const node = Object.assign(document.createElement('a'), { className: `chip suggest card-contact ${link.kind}`, href: link.href, textContent: `${link.kind === 'tel' ? '📞' : '📍'} ${link.text}` });
        if (link.kind === 'map') { node.target = '_blank'; node.rel = 'noopener'; }
        contacts.append(node);
      }
      nodes.push(contacts);
    }
    return nodes;
  };
  const checklist = () => [checklistBlock(task, { save, saveTo, notify }) ?? element('p', 'drawer-empty', 'Пунктов нет')];
  const more = () => {
    const nodes = [internalPeople(task, ctx, groups)];
    if (directory && !task.filed) nodes.push(counterpartyLine(task, { ...directory, save }));
    const createdBy = { me: 'создано вами', system: 'создано автоматически' };
    const origin = createdBy[task.createdBy] ?? `создано разбором${task.confidence !== undefined ? ` · уверенность ${Math.round(task.confidence * 100)}%` : ''}`;
    nodes.push(element('p', 'details-meta', `${origin} · ${clock.format(new Date(task.createdAt))}`));
    if (task.report && task.status === 'done') {
      nodes.push(element('p', 'picker-section', 'Отчёт'), reportBlock(task.report, fields));
      if (task.report.missing?.length && !card) nodes.push(button('link-button', 'Заполнить отчёт', () => doneCards.start(task)));
    }
    return nodes;
  };
  const items = task.items?.length ? ` ${task.items.filter((item) => item.done).length}/${task.items.length}` : '';
  const cuts = [
    { key: 'description', title: task.note ? 'Описание' : 'Описание +', nodes: description },
    { key: 'checklist', title: `Чеклист${items}`, nodes: checklist },
    { key: 'more', title: 'Подробности', nodes: more },
  ];
  head.append(cutsRow(cuts, fold, onFold, onShowTalk));
  const open = cuts.find((cut) => cut.key === fold);
  if (open) {
    const body = element('div', `card-cut-body cut-${open.key}`);
    body.append(...open.nodes());
    head.append(body);
  }
  box.append(head);

  // The conversation with the chosen one, or the task's comments.
  const conversation = selected ? partyConversation(selected, conversations) : null;
  box.append(talkPane({ task, party: selected, conversation, taskViews: views, tasksById: ctx.tasksById, bubble,
    name: selected ? namer(directory, conversations, views)(selected) : 'Комментарии задачи',
    log: taskActivity(task), unlink: (id) => save({ op: 'update', remove: [id] }), onMode: redraw }));
  onConversation(!selected || muted.includes(selected) || selected.startsWith('name:') ? null : conversation);
  box.append(peopleStrip(task, ctx, groups, recent, selected));
  return { node: box, order, selected };
}
