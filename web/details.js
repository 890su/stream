// What was chosen by a tap (CONCEPT.md §5). A task opens on the main screen, over the list (#task-screen): since
// 2026-11-22 it reads like a conversation — the head with the cuts, the conversation with the chosen interlocutor
// (or the task's comments), the interlocutors at the bottom (taskdetails.js).
// The right panel is the day plan (dayplan.js: tasks by days — a day, 4 or 7) by default — the 📅 button, a swipe from
// the right, the column of a wide screen; a message, a person or a counterparty opens there too; a left-to-right
// swipe closes it.
// While a task is open, the composer writes into it — to the participant chosen in the card when they have a chat.
import { makeTaskChange, makeCorrection, makePersonChange, makeCounterpartyChange, ownTask } from './shared.js';
import { inChat } from './actions.js';
import { personCard } from './personcard.js';
import { barContext } from './tasksheet.js';
import { counterpartyCard } from './counterpartycard.js';
import { reportKeys } from './donecard.js';
import { snippet, chatOf, sourceKey } from './projection.js';
import { STATUSES, taskOfMessage } from './taskfold.js';
import { accountTitle } from './tgbubble.js';
import { versionCard } from './versioncard.js';
import { taskDetails } from './taskdetails.js';
import { bindTalkSwipe, writeOrder, frontOrder, commentViews, conversationParty } from './cardtalk.js';
import { recipientOptions } from './tasktalk.js';
import { slideIn } from './swipezones.js';
import { isWide, onWideChange } from './layout.js';
import { holdRender } from './holdrender.js';
import { dayPlan } from './dayplan.js';
import { getSetting } from './db.js';
import { participants } from './participants.js';
import { participantOptions, setupParticipantPicker } from './participantpicker.js';
import { acceptEvents } from './proposals.js';
import { rejectEvent, runRecheck } from './recheck.js';

const clock = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const SOURCES = { me: 'мои заметки', phone: 'телефон', system: 'система' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setupDetails({ feed, composer, notify, doneCards, config, quick, onRender = () => {}, openConversation = () => {} }) {
  const panel = document.querySelector('#details');
  const backdrop = document.querySelector('#details-backdrop');
  const body = document.querySelector('#details-body');
  const heading = document.querySelector('#details-heading');
  let current = null; // the right panel: { kind: 'planner' | 'message' | 'person' | 'counterparty', id }
  const screen = document.querySelector('#task-screen');
  const screenBody = document.querySelector('#task-screen-body');
  const moreButton = document.querySelector('#task-screen-more');
  let taskId = null; // the task open on the main screen
  let talk = null; // the card's conversation: { party (undefined — not chosen yet, null — the comments), order, swiped }
  let fold = null; // the open cut of the card: 'description' | 'checklist' | 'more' | null
  let showBar = false; // ⋯ in the head: the action bar shown in the card
  let replyKey; // the chat the card put into the composer as the recipient (undefined — none yet: the first steer applies)
  let before = null; // the composer's recipient when the card opened, given back when it closes
  const openParticipantPicker = setupParticipantPicker(document.querySelector('#task-participant-picker'));

  const save = (taskId, change) => composer.queue(makeTaskChange(taskId, change)).then(() => true, (error) => { notify(error.message); return false; });
  const tasksById = () => new Map(feed.tasks().map((task) => [task.id, task]));
  // The directory for «Кто контрагент?» and the cards (contacts design §6).
  const queue = (entry) => composer.queue(entry).catch((error) => { notify(error.message); throw error; });
  const directory = () => ({ counterparties: feed.counterparties(), people: feed.people(),
    saveCounterparty: (id, change) => queue(makeCounterpartyChange(id, change)), savePerson: (id, change) => queue(makePersonChange(id, change)).catch(() => {}),
    onOpen: (id) => openCounterparty(id) });

  function place() {
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const bottom = window.innerHeight - document.querySelector('.composer-area').getBoundingClientRect().top;
    document.documentElement.style.setProperty('--drawer-top', `${Math.max(0, top)}px`);
    document.documentElement.style.setProperty('--drawer-bottom', `${Math.max(0, bottom)}px`);
  }

  function messageDetails(view) {
    const box = element('div', 'details-messagecard');
    const card = versionCard(view);
    box.append(card);
    const source = chatOf(view.event)?.title ? `${accountTitle(chatOf(view.event).account)} · ${chatOf(view.event).title}` : SOURCES[sourceKey(view.event)] ?? view.event.source;
    box.append(element('p', 'details-meta', `${clock.format(new Date(view.event.ts))} · ${source}${view.edited ? ' · изменено' : ''}`));
    if (view.tags.length) box.append(element('p', 'details-meta', view.tags.join(' ')));
    box.append(element('p', 'picker-section', 'Задачи'));
    const tasks = view.taskIds.map((id) => tasksById().get(id)).filter(Boolean);
    for (const task of tasks) {
      const row = element('button', `task-row ${task.status}`);
      row.type = 'button';
      row.append(element('span', 'task-title', task.title), element('span', 'task-meta', STATUSES[task.status] ?? task.status));
      row.onclick = () => openTask(task.id);
      box.append(row);
    }
    if (!tasks.length) {
      const make = element('button', 'link-button', 'Сделать задачей');
      make.type = 'button';
      make.onclick = () => createFrom(view);
      box.append(make);
    }
    requestAnimationFrame(() => card.ready?.());
    return box;
  }

  // While a name is typed or a list of choices is open in the panel, a live update waits (holdrender.js).
  // Each box holds its own redraws while something is typed or chosen in it (holdrender.js).
  const holdPanel = holdRender(panel, () => draw());
  const holdTask = holdRender(screen, () => drawTask());
  const render = () => { holdPanel(); holdTask(); };
  const redrawTask = () => drawTask();

  function addParticipant(task, anchor) {
    const options = participantOptions({ conversations: feed.conversations(), recipients: composer.knownRecipients(),
      people: feed.people(), exclude: participants(task).map((item) => item.party) });
    openParticipantPicker(anchor, {
      options, limit: config.tasks?.card?.participant_suggestions ?? 6,
      onPick(party) {
        const current = feed.task(task.id);
        if (!current || participants(current).some((item) => item.party === party)) return;
        save(task.id, { op: 'update', roles: { members: [...(current.roles?.members ?? []), party] } });
      },
      onClose() {
        drawTask();
        screenBody.querySelector('.task-external-people .people-add')?.focus({ preventScroll: true });
      },
    });
  }

  // The task card on the main screen.
  function drawTask() {
    if (!taskId || screen.hidden) return;
    const task = feed.task(taskId);
    if (!task) { closeTask(); return; }
    const scroll = screenBody.scrollTop;
    const atEnd = screenBody.scrollHeight - scroll - screenBody.clientHeight < 80; // a chat: the newest stays in view
    const draft = document.activeElement?.matches('.checklist-add input') && screenBody.contains(document.activeElement) ? document.activeElement.value : null;
    moreButton.setAttribute('aria-expanded', String(showBar));
    const drawn = taskDetails(task, {
      views: feed.taskViews(task.id), bubble: (view) => feed.bubble(view), save: (change) => save(task.id, change), saveTo: save,
      notify, projects: feed.projects(), doneCards, fields: config.tasks?.report_fields ?? {}, cardSettings: config.tasks?.card,
      directory: directory(), bar: showBar && quick ? barContext(task, { feed, quick, openConversation }) : null,
      conversations: feed.conversations(), tasksById: tasksById(), talk, redraw: redrawTask, onConversation: steer, onTalk: openTalk,
      onScope: (scope) => { if (talk) { talk.scope = scope; showTalk(); } }, onReply: replyIn,
      fold, onFold: (key) => { fold = fold === key ? null : key; drawTask(); }, onShowTalk: showTalk,
      onAdd: (anchor) => addParticipant(task, anchor),
      recheck: recheckContext(task),
      onDone: () => { if (['done', 'cancelled'].includes(task.status)) quick?.act(task, { status: 'todo' }, `Снова в работе: «${task.title}»`); else quick?.done(task); },
    });
    if (talk) {
      talk.order = drawn.order;
      talk.party = drawn.selected;
    }
    composer.hint(drawn.hint);
    lastDrawn = drawn; // the long press on «Отправить» lists its people (recipientsOfCard)
    screenBody.replaceChildren(drawn.node);
    screenBody.scrollTop = atEnd ? screenBody.scrollHeight : scroll;
    const input = screenBody.querySelector('.checklist-add input');
    if (input && draft !== null) {
      input.value = draft;
      input.dispatchEvent(new Event('input'));
      input.focus({ preventScroll: true });
    }
    requestAnimationFrame(place); // the input row changes height (its participants line hides under the card)
  }

  // «✨ Сверить с перепиской» (recheck.js): the request with its toast, the waiting proposals with ✓ ✕.
  let rechecking = null; // the task being rechecked: the button waits
  function recheckContext(task) {
    return {
      proposals: feed.rechecks(task.id), tasksById: tasksById(), busy: rechecking === task.id,
      run: async () => {
        if (rechecking) return;
        rechecking = task.id;
        notify('Сверяю с перепиской…');
        drawTask();
        try { notify(await runRecheck(task.id, { token: await getSetting('ownerToken') })); } finally { rechecking = null; }
        await feed.render().catch((error) => notify(error.message));
        drawTask();
      },
      accept: async (item) => {
        try { for (const entry of acceptEvents(item)) await composer.queue(entry); notify('Принято'); } catch (error) { notify(error.message); }
      },
      reject: (item) => composer.queue(rejectEvent(item, task.messages[0])).then(() => notify('Отклонено'), (error) => notify(error.message)),
    };
  }

  // A swipe moves to the next interlocutor without reordering the tiles; the first keystroke then puts him leftmost.
  let swipedTo = null;
  document.querySelector('#message').addEventListener('input', () => {
    if (!swipedTo || !talk || talk.party !== swipedTo) { swipedTo = null; return; }
    const order = frontOrder(talk.order, swipedTo, true);
    swipedTo = null;
    talk.swiped = false;
    writeOrder(taskId, order);
    drawTask();
  });

  // «Ответить» under someone's message in the card: that person becomes the chosen tile (their chat gets the reply)
  // and the message is quoted (CONCEPT.md §5, 2026-11-24).
  function replyIn(view) {
    if (!taskId || !talk) return;
    const conversation = feed.conversations().find((item) => item.views.some((each) => each.id === view.id));
    const party = conversation ? conversationParty(conversation) : null;
    if (party && party !== talk.party) { talk.party = party; drawTask(); }
    composer.reply(view);
  }

  // The long press on «Отправить» while a task card is open: its people with each of their chats, and the comment.
  let lastDrawn = null;
  function recipientsOfCard() {
    if (!taskId || !talk || !lastDrawn) return null;
    return recipientOptions(lastDrawn.parties, feed.conversations(), lastDrawn.name).map((option) => ({ label: option.label, choose: () => {
      talk.party = option.party;
      drawTask();
      if (option.chat) composer.choose(option.chat);
    } }));
  }

  // A tap on a tile: that interlocutor's conversation; on the chosen one — off, the task's comments. The cuts fold
  // and the newest messages show, as in a conversation.
  function openTalk(party, { swiped = false } = {}) {
    if (!taskId || !talk) return;
    talk.party = !party || party === talk.party ? null : party;
    swipedTo = swiped ? talk.party : null;
    talk.swiped = swiped;
    if (!swiped && talk.party && talk.order.includes(talk.party)) writeOrder(taskId, frontOrder(talk.order, talk.party, true));
    showTalk();
    screenBody.querySelector('.person-tile.selected .person-tile-body')?.focus({ preventScroll: true });
  }
  // 💬: the cuts fold, the conversation shows from its newest message.
  function showTalk() {
    fold = null;
    drawTask();
    screenBody.scrollTop = screenBody.scrollHeight;
  }

  // What a message written in the card continues: in the comments the last comment (none yet — the composer adds it to
  // the task itself), else the task's last message of a conversation — so a comment never joins someone's chat.
  function topicLast(id) {
    const views = feed.taskViews(id);
    const notes = new Set(commentViews(views));
    return (talk?.party === null ? [...notes] : views.filter((view) => !notes.has(view))).at(-1) ?? null;
  }

  // The answer goes to the participant chosen in the conversations when they have a chat; else it is a note in the task.
  function steer(conversation) {
    const reply = conversation?.reply ?? null;
    const key = reply ? `${reply.account}:${reply.chat_id}` : null;
    if (key === replyKey) return;
    replyKey = key;
    composer.chat(reply);
  }

  function showTask(id) {
    const same = taskId === id;
    const wasOpen = Boolean(taskId);
    if (!wasOpen) { before = composer.recipient() ?? null; replyKey = undefined; }
    if (!same) { talk = { party: undefined, order: [], swiped: false }; fold = null; showBar = false; }
    taskId = id;
    place();
    screen.hidden = false;
    // On a phone the right panel gives way to the card. Over an open card its entry is popped (the card's own entry
    // stays under it); else it becomes the card's — a back of its own would race the card's entry and close the card.
    if (wasOpen && !same && history.state?.talk) history.go(history.state.details ? -2 : -1);
    else if (!isWide() && history.state?.details) { hide(); if (wasOpen) history.back(); else history.replaceState({ task: true }, ''); }
    else if (!history.state?.task) history.pushState({ task: true }, '');
    if (!isWide() && current) hide();
    composer.enterTopic({ task: id, last: () => topicLast(id) }, 'Сообщение в задачу');
    onRender();
    drawTask();
    if (!same) screenBody.scrollTop = screenBody.scrollHeight; // the newest messages, like a conversation
  }

  function hideTask() {
    if (!taskId) return;
    taskId = null;
    talk = null;
    screen.hidden = true;
    screenBody.replaceChildren();
    composer.leaveTopic();
    // The recipient goes back to what it was before the card (an open conversation's chat, one chosen by hand).
    if (replyKey !== undefined) composer.chat(before);
    replyKey = undefined;
    before = null;
    onRender();
    feed.render(); // a completion card shown in the card goes back to the feed
  }

  function closeTask() {
    const had = Boolean(taskId);
    const state = history.state;
    hideTask();
    if (had && state?.task) history.go(-1 - Number(Boolean(state.talk)) - Number(Boolean(state.details)));
  }

  // Another view takes the screen: the card closes and its entry is popped first; resolves once that is done.
  function leaveTask() {
    if (!taskId) return Promise.resolve();
    if (!history.state?.task) { hideTask(); return Promise.resolve(); }
    return new Promise((resolve) => {
      const done = () => { window.removeEventListener('popstate', done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 400);
      window.addEventListener('popstate', done);
      closeTask();
    });
  }

  // Google Calendar events for the plan (/api/calendar): asked at most once a minute while the plan is drawn.
  const calendar = { events: [], titles: new Map(), at: 0, busy: false };
  async function loadCalendar() {
    if (calendar.busy || Date.now() - calendar.at < 60_000) return;
    calendar.busy = true;
    try {
      const response = await fetch('/api/calendar', { headers: { Authorization: `Bearer ${await getSetting('ownerToken')}` } });
      if (!response.ok) return;
      const data = await response.json();
      calendar.events = data.events ?? [];
      calendar.titles = new Map((data.calendars ?? []).map((item) => [item.id, item.title]));
      calendar.at = Date.now();
      if (current?.kind === 'planner' || (!current && isWide())) draw();
    } catch { /* offline: the plan shows the tasks only */ } finally { calendar.busy = false; }
  }

  function draw() {
    onRender(); // the view switch counts the open task's conversations
    // The day plan: what is open there when nothing else is; on a wide screen the column shows it by default.
    if (!current || current.kind === 'planner') {
      if (!current && !isWide()) return;
      if (panel.hidden) return;
      heading.textContent = 'План';
      const scroll = body.scrollTop;
      body.replaceChildren(dayPlan({ tasks: feed.tasks(), events: calendar.events, calendars: calendar.titles, onOpenTask: (id) => openTask(id), redraw: draw }));
      loadCalendar();
      body.scrollTop = scroll;
      return;
    }
    if (panel.hidden) return;
    const scroll = body.scrollTop;
    const typing = Boolean(document.activeElement?.closest?.('.checklist-add')); // adding items one after another
    if (current.kind === 'person' || current.kind === 'counterparty') {
      // The directory's cards (contacts design §6).
      const dir = directory();
      const cardCtx = { ...dir, tasks: feed.tasks(), onOpenPerson: openPerson, onOpenCounterparty: openCounterparty, onOpenTask: openTask };
      const item = (current.kind === 'person' ? dir.people : dir.counterparties).find((entry) => entry.id === current.id);
      // Just created: the feed folds it on its next render, which redraws this panel.
      if (!item) { heading.textContent = 'Сохраняется…'; body.replaceChildren(); return; }
      heading.textContent = current.kind === 'person' ? item.name : item.title;
      body.replaceChildren(current.kind === 'person' ? personCard(item, cardCtx) : counterpartyCard(item, cardCtx));
    } else {
      const view = feed.view(current.id);
      if (!view) { close(); return; }
      heading.textContent = 'Сообщение';
      body.replaceChildren(messageDetails(view));
    }
    body.scrollTop = scroll;
    if (typing) body.querySelector('.checklist-add input')?.focus({ preventScroll: true });
  }

  function show(next) {
    const same = current?.kind === next.kind && current?.id === next.id;
    current = next;
    panel.hidden = false;
    if (!isWide()) {
      place();
      backdrop.hidden = false;
      void panel.offsetWidth; // the closed position first, so the opening slides in
      panel.classList.add('open');
      if (!history.state?.details) history.pushState({ ...(taskId ? { task: true, talk: Boolean(talk) } : {}), details: true }, '');
    }
    if (!taskId) composer.leaveTopic();
    draw();
    if (!same) body.scrollTop = 0;
  }

  // The screen swipe from the right (swipezones.js): what is open here, else the day plan.
  const openPlanner = () => show({ kind: 'planner', id: 'plan' });
  const reopen = () => { if (current) return true; openPlanner(); return true; };
  const openTask = (id) => showTask(id);
  const openMessage = (id) => show({ kind: 'message', id });
  const openPerson = (id) => show({ kind: 'person', id });
  const openCounterparty = (id) => show({ kind: 'counterparty', id });
  // The chain title above a message: its first open task, else its latest task, else the message itself.
  function openFor(view) {
    const task = taskOfMessage(view, tasksById());
    if (task) openTask(task.id); else openMessage(view.id);
  }

  function hide() {
    if (isWide()) { current = null; if (!taskId) composer.leaveTopic(); feed.render(); draw(); return; }
    if (panel.hidden) return;
    current = null;
    panel.classList.remove('open');
    backdrop.hidden = true;
    if (!taskId) composer.leaveTopic();
    feed.render(); // a completion card shown here goes back to the feed
    setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, 230);
  }

  function close() {
    hide();
    if (!isWide() && history.state?.details) history.back();
  }

  // «Сделать задачей»: a task of mine with this message; its details open to rename or reassign.
  // A message of a chat goes into a conversation of its own, named by this task (an own note does so by itself).
  async function createFrom(view) {
    const id = crypto.randomUUID();
    await save(id, ownTask(snippet(view).slice(0, 120), view.id));
    if (inChat(view) && !view.split) await composer.queue(makeCorrection(view.id, 'split')).catch((error) => notify(error.message));
    openTask(id);
  }

  document.body.addEventListener('click', (event) => {
    const mark = event.target.closest('[data-task-open]');
    if (mark) { event.stopPropagation(); openTask(mark.dataset.taskOpen); }
  });
  document.querySelector('#details-close').onclick = close;
  backdrop.onclick = close;
  window.addEventListener('popstate', () => {
    if (!isWide() && !history.state?.details) hide();
    if (taskId && !history.state?.task && !history.state?.details) hideTask();
  });
  // «назад» in the head: from the card to where it was opened.
  document.querySelector('#task-screen-back').onclick = () => closeTask();
  moreButton.onclick = () => { showBar = !showBar; drawTask(); };
  bindTalkSwipe(screen, () => Boolean(taskId && talk), (step) => {
    const { order, party } = talk;
    const index = order.indexOf(party);
    if (order.length < 2 || index < 0) return;
    openTalk(order[(index + step + order.length) % order.length], { swiped: true });
    slideIn(screenBody.querySelector('.card-talk'), step > 0 ? 'next' : 'prev');
  });
  // Crossing the breakpoint: a column of its own, or a panel that slides over the feed.
  const dock = (wide) => {
    panel.classList.remove('open'); backdrop.hidden = true;
    if (wide) { panel.hidden = false; render(); return; }
    if (current) { current = null; if (!taskId) composer.leaveTopic(); }
    panel.hidden = true;
  };
  onWideChange(dock);
  if (isWide()) dock(true);
  window.addEventListener('resize', () => { if (!panel.hidden || !screen.hidden) place(); });

  document.querySelector('#planner-button').onclick = () => (current?.kind === 'planner' && !isWide() ? close() : openPlanner());

  return { render, openTask, openMessage, openPerson, openCounterparty, openPlanner, openFor, createFrom, close, closeTask, leaveTask, reopen,
    current: () => (taskId ? { kind: 'task', id: taskId } : current), taskOpen: () => Boolean(taskId), screen,
    panel, isOpen: () => !isWide() && panel.classList.contains('open'), recipientsOfCard, replyIn };
}
