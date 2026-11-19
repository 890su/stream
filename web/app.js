// Stream PWA entry point: wires the centre («Беседы · Задачи», Лента from ⋮), filters on the left, details on the right,
// the composer, and starts sync and live updates.
import { getSetting } from './db.js';
import { watchDialogs } from './backclose.js';
import { setupComposer } from './composer.js';
import { setupFeed } from './feed.js';
import { startSync } from './outbox.js';
import { startLive } from './live.js';
import { setupActions } from './actions.js';
import { makeCorrection, makeProjectChange, makeTaskChange } from './shared.js';
import { setupPicker } from './picker.js';
import { setupBulk } from './bulk.js';
import { setupStatus, setupSettings, registerWorker } from './settings.js';
import { setupDrawer } from './drawer.js';
import { setupSystem } from './system.js';
import { setAccounts } from './tgbubble.js';
import { setupChatView } from './chatview.js';
import { setupDetails } from './details.js';
import { conversationOf } from './conversations.js';
import { reveal, conceal } from './motion.js';
import { createDoneCards } from './donecard.js';
import { createTaskQuick } from './taskquick.js';
import { createConvQuick } from './convquick.js';
import { setupQuestions } from './question.js';
import { setupViewSwitch } from './viewswitch.js';
import { isWide } from './layout.js';
import { listCount } from './tasklist.js';
import { visibleTasks } from './filters.js';

let details; // right panel «Подробности» (CONCEPT.md §5)
let doneCards;
let taskQuick; // taskquick.js: task actions with «Вернуть»
let picker;
let bulk;
let drawer;
let system;
let chatView; // { open(key), close(), sync() } — one conversation (CONCEPT.md §2.5)
let viewSwitch; // the «Беседы» / «Задачи» button of the input row
let goView; // switches the view and opens a conversation (setupViews)

// «Беседы» / «Задачи» (CONCEPT.md §5): the switch at the right end of the input row (viewswitch.js); the choice is
// remembered on this device. The technical Лента opens from ⋮ («Лента сообщений») and is not remembered. Views saved
// by earlier versions map to the new ones (feed.js).
function setupViews(feed) {
  const update = () => viewSwitch?.update();
  let saved = 'conversations';
  try { saved = localStorage.getItem('stream.feedMode') ?? 'conversations'; } catch { /* private mode */ }
  if (saved === 'feed' || saved === 'messages') saved = 'conversations';
  feed.setMode(saved);
  try { if (saved !== feed.mode()) localStorage.setItem('stream.feedMode', feed.mode()); } catch { /* private mode */ }
  const after = () => { chatView?.sync(); updateFilter(); drawer?.render(); update(); };
  // `key` — a conversation to open (from a task or a conversation filter); Задачи keep an open conversation as a filter.
  async function go(next, key = null) {
    try { localStorage.setItem('stream.feedMode', next); } catch { /* private mode */ }
    if (next === 'conversations' && details?.current()?.kind === 'task' && !isWide()) details.close();
    await feed.setMode(next);
    if (next === 'conversations' && key && key !== chatView?.key()) await chatView.open(key);
    after();
  }
  goView = go;
  // The counter on Беседы: the pulse when it is the default of Задачи, else the first list.
  const todayCount = () => {
    const first = feed.taskFilters()[0];
    if (first?.view === 'pulse') return feed.pulseCount();
    return first ? listCount(visibleTasks(feed.tasks(), { filter: first }), first) : 0;
  };
  viewSwitch = setupViewSwitch({ feed, todayCount, taskId: () => (details?.current()?.kind === 'task' ? details.current().id : null), go });
  update();
  // ⋮ → «Лента сообщений».
  $('#feed-button').onclick = async () => {
    $('#settings').close();
    if (chatView?.key()) chatView.leave();
    await feed.setMode('feed');
    after();
  };
}

// The reset button next to the filter icon shows how many tags (and, in the Лента, sources) filter the centre.
function updateFilter() {
  const count = (feedRef?.tagFilter().length ?? 0) + (feedRef?.mode() === 'feed' && feedRef?.sourceFilter() ? 1 : 0);
  $('#filter-reset').hidden = !count;
  $('#filter-count').textContent = count ? String(count) : '';
  $('#drawer-button').classList.toggle('active', Boolean(count));
}
let feedRef;
let composerRef; // tag suggestions follow the feed: frequent tags are known once it is loaded

const $ = (selector) => document.querySelector(selector);
const notice = $('#notice');
let noticeTimer;

// A short message at the bottom; `action` adds one button, e.g. undo.
function notify(message, action) {
  $('#notice-text').textContent = message;
  const button = $('#notice-action');
  button.hidden = !action;
  if (action) {
    button.textContent = action.label;
    button.onclick = () => { conceal(notice); action.run(); };
  }
  reveal(notice);
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => conceal(notice), action ? 6000 : 4500);
}

function setupMessageActions(feed, composer, config) {
  // Photos are thumbnails in the feed; a tap opens them full size.
  const viewer = $('#viewer');
  $('#viewer-close').onclick = () => viewer.close();
  viewer.addEventListener('click', (event) => { if (event.target === viewer || event.target.id === 'viewer-image') viewer.close(); });
  document.body.addEventListener('click', (event) => {
    const image = event.target.closest('[data-viewer]');
    if (!image?.src) return;
    $('#viewer-image').src = image.src;
    $('#viewer-image').alt = image.alt;
    viewer.showModal();
  });
  const correct = (view, op) => composer.queue(makeCorrection(view.id, op)).catch((error) => notify(error.message));
  picker = setupPicker({ getVisible: () => feed.visible(), getChain: (id) => feed.chain(id), notify });
  const link = (view, target) => composer.queue(makeCorrection(view.id, 'link', { target })).catch((error) => notify(error.message));
  // Connect a message to any other one chosen in the picker.
  const pickLink = (view) => picker.open({ exclude: view.id, onPick: async (target) => {
    await link(view, target.id);
    notify('Связано', { label: 'Отменить', run: () => correct(view, 'unlink') });
  } });
  bulk = setupBulk(feed, composer, { correct, link, pickLink, notify });
  chatView = setupChatView({ feed, composer, correct, notify, openTask: (id) => details.openTask(id), openPerson: (id) => details.openPerson(id) });
  details = setupDetails({ feed, composer, notify, doneCards, config, quick: taskQuick, onRender: () => viewSwitch?.update() });
  system = setupSystem({ notify, onTrack: (messageId) => composer.queue(makeCorrection(messageId, 'track')).catch((error) => notify(error.message)) });
  drawer = setupDrawer({
    feed,
    onCreateProject: (project) => composer.queue(makeProjectChange(crypto.randomUUID(), { op: 'create', status: 'active', ...project })).catch((error) => notify(error.message)),
    onContact: (key) => chatView.open(key),
    onFilterChange: updateFilter,
  });
  setupActions({
    list: document.body, // the centre and the details panel share the same message actions
    getView: (id) => feed.view(id),
    onAction: async (op, view) => {
      if (op === 'reply') composer.reply(view);
      else if (op === 'task') details.createFrom(view);
      else if (op === 'split') {
        const back = view.split ? 'split' : 'unsplit';
        await correct(view, view.split ? 'unsplit' : 'split');
        notify(view.split ? 'Сообщение возвращено в беседу' : 'Сообщение — отдельной беседой', { label: 'Отменить', run: () => correct(view, back) });
      }
      else if (op === 'chat-open') chatView.open(conversationOf(view.event));
      else if (op === 'system') system.open();
      else if (op === 'retry') { if (view.delivery?.action) system.retry(view.delivery.action); }
      else if (op === 'edit') composer.edit(view);
      else if (op === 'history') details.openMessage(view.id);
      else if (op === 'continue') composer.proceed(view);
      else if (op === 'unlink-next') {
        const next = feed.nextLinked(view.id);
        if (!next) return;
        await correct(next, 'unlink');
        notify('Следующее сообщение отвязано', { label: 'Отменить', run: () => link(next, view.id) });
      } else if (op === 'link-from') pickLink(view);
      else if (op === 'pick') picker.take(view);
      else if (op === 'select') bulk.enter(view);
      else if (op === 'toggle') bulk.toggle(view);
      else if (op === 'topic-open') details.openFor(view);
      else if (op === 'link') {
        if (view.continues) { await correct(view, 'unlink'); notify('Отделено от предыдущего', { label: 'Отменить', run: () => link(view, view.continues) }); return; }
        pickLink(view);
      }
      else if (op === 'copy') {
        try { await navigator.clipboard.writeText(view.text); notify('Текст скопирован'); }
        catch { notify('Не удалось скопировать: браузер не дал доступ к буферу обмена'); }
      } else if (op === 'archive') {
        const back = view.archived;
        await correct(view, back ? 'unarchive' : 'archive');
        notify(back ? 'Возвращено из архива' : 'В архиве', { label: back ? 'Отменить' : 'Вернуть', run: () => correct(view, back ? 'archive' : 'unarchive') });
      } else if (op === 'delete') {
        await correct(view, 'delete');
        notify('Сообщение удалено', { label: 'Отменить', run: () => correct(view, 'restore') });
      }
    },
  });
}

async function main() {
  watchDialogs(); // the system back closes an open dialog instead of leaving the app
  // Chrome on Android: let the keyboard overlay the page so CSS can slide the layout instead of a jump resize.
  if ('virtualKeyboard' in navigator) navigator.virtualKeyboard.overlaysContent = true;
  const response = await fetch('/capture-config.json');
  if (!response.ok) throw new Error('Не удалось загрузить настройки приложения. Повторите запуск');
  const config = await response.json();
  setAccounts(config.telegram?.accounts);
  const onQueue = setupStatus();
  let quick = null; // task actions where a task is seen (taskquick.js), once the composer's queue exists
  const quickRef = { decorate: (item, task) => quick?.decorate(item, task), done: (task) => quick?.done(task), act: (...args) => quick?.act(...args), reset: () => quick?.reset(),
    start: (task, current) => quick?.start(task, current), pause: (task) => quick?.pause(task) };
  let convQuick = null; // swipes on conversation rows (convquick.js), once the composer's queue exists
  const convQuickRef = { decorate: (row, conversation) => convQuick?.decorate(row, conversation) };
  const feed = setupFeed({ notify, onQueue, limits: config, onOpenTask: (id) => details.openTask(id), onOpenConversation: (key) => chatView.open(key),
    quick: quickRef, convQuick: convQuickRef, onMoreLists: () => drawer?.open(), onGoConversation: (key) => goView?.('conversations', key),
    // The open project (CONCEPT.md §2.11): its changes and a task added to one of its sections.
    projectActions: {
      saveProject: (change) => { const project = feedRef.project(); if (project) composerRef.queue(makeProjectChange(project.id, { op: 'update', ...change })).catch((error) => notify(error.message)); },
      addTask: (title, section) => { const project = feedRef.project(); if (project) composerRef.queue(makeTaskChange(crypto.randomUUID(), { op: 'create', title, roles: { author: 'me', responsible: 'me', executors: ['me'] }, status: 'todo', project: project.id, section })).catch((error) => notify(error.message)); },
      leave: () => { feedRef.setProject(null); drawer?.render(); },
    },
    taskCard: (task) => (details?.current()?.id === task.id ? null : doneCards?.card(task)), onRender: () => { details?.render(); bulk?.repaint(); drawer?.render(); chatView?.sync(); composerRef?.refreshTags(); viewSwitch?.update(); } });
  feedRef = feed;
  const composer = setupComposer(config, { notify, onSent: () => feed.render({ bottom: true }), getViews: () => feed.views(),
    // The link window's sections: conversations and tasks as the feed sees them, and what is open now.
    linkContext: () => {
      const open = details?.current()?.kind === 'task' ? details.current().id : null;
      const key = feed.conversationKey();
      const today = feed.taskFilters().find((item) => item.id === 'today');
      return { conversations: feed.conversations(), tasks: feed.tasks(), openConversation: key, openTask: open,
        conversationTasks: feed.conversations().find((item) => item.key === key)?.tasks ?? [],
        today: today ? visibleTasks(feed.tasks(), { filter: today }) : [] };
    } });
  composerRef = composer;
  taskQuick = quick = createTaskQuick({ queue: composer.queue, notify, config });
  // A new task is opened once the feed has drawn it (the queue redraws without waiting).
  convQuick = createConvQuick({ queue: composer.queue, notify, openTask: async (id) => { if (!feed.task(id)) await feed.render(); details.openTask(id); } });
  doneCards = createDoneCards({ config, queue: composer.queue, notify, onChange: () => { details?.render(); feed.render(); }, close: (task) => quick.done(task), drop: (task) => quick.act(task, { proposed: null }, `Ещё не готово: «${task.title}»`) });
  setupViews(feed);
  setupQuestions({ getView: (id) => feed.view(id), getTask: (id) => feed.task(id), queue: composer.queue, notify });
  setupMessageActions(feed, composer, config);
  window.addEventListener('queue-change', () => feed.render().catch((error) => notify(error.message)));
  const live = startLive({
    getToken: () => getSetting('ownerToken'),
    onEvent: (event) => feed.receive(event).then(() => composer.refreshTags()).catch((error) => notify(error.message)),
    onConnect: () => feed.refresh(),
  });
  await setupSettings(config, feed, () => live.reconnect(), { notify, drawer: () => drawer, system: () => system, updateFilter });
  await registerWorker(feed, composer, notify);
  startSync(config, notify);
  await feed.refresh();
  composer.refreshTags(); // frequent tags are known once the feed is loaded
  composer.loadRecipients();
  // Fallback only: while the live stream is up, new messages arrive without polling.
  setInterval(() => { if (!document.hidden && !live.connected()) feed.refresh(); }, config.feed_refresh_ms);
  // The pulse counts time (waiting hours, minutes in work, midnight): redraw it each minute while it is on screen.
  setInterval(() => { if (!document.hidden && feed.mode() === 'tasks') feed.render(); }, 60_000);

  const mode = new URL(location.href).searchParams.get('mode');
  if (new URL(location.href).searchParams.has('shared')) feed.scrollToBottom();
  if (mode === 'voice') await composer.record();
  if (mode === 'text') composer.focus();
  if (mode === 'photo') { composer.openAttach(); notify('Выберите «Камера» или «Галерея»'); }
  navigator.storage?.persist?.().catch(() => {});
}

main().catch((error) => notify(`Не удалось открыть Stream. ${error.message}`));
