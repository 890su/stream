// The task card on the main screen (docs/plans/2026-11-20-queue-and-task-screen-design.md, stage 2): the title, the
// description (the task's note — the triage writes it, the owner edits it), «контрагент · срок · статус», «дальше»,
// the project, «Задача выполнена?», a call and a map, the action bar; «Подробности» folded (checklist, how it was
// made, report, log); then the participants line, always shown — the chosen tile leftmost with 📣 — and under it the
// whole conversation with that participant (cardtalk.js).
import { describeChange } from './taskfold.js';
import { checklistBlock } from './checklist.js';
import { projectLine } from './projectpanel.js';
import { personOf } from './contacts.js';
import { actionBar } from './taskbar.js';
import { headline, nextStep, contactLinks, section } from './taskcard.js';
import { participants, participantsBlock } from './participants.js';
import { partyName } from './parties.js';
import { partyConversation, cardOrder, readOrder, writeOrder, talkPane, lastSpeaker } from './cardtalk.js';

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

// `ctx`: { views (the task's messages), bubble(view), save(change), saveTo(id, change), others (open tasks), notify,
// doneCards, projects, fields, directory (contacts), bar (the action bar's context), conversations (all),
// redraw(), onConversation(conversation | null) — the chosen participant's conversation, for the composer }.
export function taskDetails(task, { views, bubble, save, saveTo, others, notify, projects = [], doneCards, fields, directory = null, bar = null,
  conversations = [], redraw = () => {}, onConversation = () => {}, now = new Date() }) {
  const box = element('div', 'details-task');
  // The top: what it is, with whom, when, the state, what next — the five seconds (task manager spec §2).
  box.append(titleBlock(task, save), descriptionBlock(task, save));
  const line = headline(task, now);
  if (line.length) box.append(element('p', 'card-headline', line.join(' · ')));
  const next = nextStep(task);
  if (next) box.append(element('p', 'card-next', `дальше: ${next}`));
  box.append(projectLine(task, { projects, save }));
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

  // The same six icons as the long-press sheet (task card design §3).
  if (bar) {
    const actions = element('div', 'card-bar');
    actions.append(actionBar(task, bar));
    box.append(actions);
  }

  // «Подробности», folded: the checklist, how it was made, the report of a closed task, the log.
  const checklist = checklistBlock(task, { save, saveTo, others, notify });
  const more = [];
  if (checklist) more.push(checklist);
  const origin = task.createdBy === 'me' ? 'создано вами' : `создано разбором${task.confidence !== undefined ? ` · уверенность ${Math.round(task.confidence * 100)}%` : ''}`;
  more.push(element('p', 'details-meta', `${origin} · ${clock.format(new Date(task.createdAt))}`));
  if (task.report && task.status === 'done') {
    more.push(element('p', 'picker-section', 'Отчёт'), reportBlock(task.report, fields));
    if (task.report.missing?.length && !card) more.push(button('link-button', 'Заполнить отчёт', () => doneCards.start(task)));
  }
  more.push(element('p', 'picker-section', 'Лог'));
  const log = [...(task.history ?? [])].reverse().map((item) => {
    const who = item.author === 'me' ? 'вы' : item.change?.processor ? 'разбор' : 'система';
    return element('div', 'details-fact', `${clock.format(new Date(item.ts))} · ${who} · ${describeChange(item.change ?? {})}`);
  });
  more.push(...(log.length ? log : [element('p', 'drawer-empty', 'Изменений нет')]));
  const done = task.items?.filter((item) => item.done).length ?? 0;
  const summary = ['Подробности', task.items?.length ? `чеклист ${done}/${task.items.length}` : '', !task.project && task.project_options?.length ? 'в какой проект?' : ''].filter(Boolean).join(' · ');
  box.append(section('more', summary, more));

  // The participants line, always shown; the chosen one leftmost; under it the conversation with them.
  const parties = participants(task).map((item) => item.party);
  const lastAuthor = lastSpeaker(views, parties, task.muted ?? []);
  const order = cardOrder(parties, { stored: readOrder(task.id), lastAuthor });
  const selected = order[0] ?? 'me';
  const conversation = selected === 'me' ? null : partyConversation(selected, conversations);
  // A name: the directory's, else the title of the participant's conversation, else as the messages say.
  const nameOf = (party) => directory?.people.find((person) => person.status !== 'deleted' && person.points.includes(party))?.name
    ?? (party !== 'me' ? partyConversation(party, conversations)?.title : null) ?? partyName(party, views);
  box.append(participantsBlock(task, { strip: true, views, nameOf, people: directory?.people ?? [], counterparties: directory?.counterparties ?? null,
    save, savePerson: directory?.savePerson, saveCounterparty: directory?.saveCounterparty, onOpenCounterparty: directory?.onOpen,
    select: { order, selected, onSelect: (party) => { writeOrder(task.id, [party, ...order.filter((item) => item !== party)]); redraw(); } } }));
  box.append(talkPane({ task, party: selected, conversation, taskViews: views, bubble, name: nameOf(selected),
    unlink: (id) => save({ op: 'update', remove: [id] }), onMode: redraw }));
  // A switched-off participant gets no answer from the task: the message stays a note (PLAN 2026-11-20).
  onConversation((task.muted ?? []).includes(selected) ? null : conversation);
  return box;
}
