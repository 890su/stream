// Stream PWA entry point: wires the feed, composer, panels and screens together and starts sync and live updates.
import { getSetting } from './db.js';
import { setupComposer } from './composer.js';
import { setupFeed } from './feed.js';
import { startSync } from './outbox.js';
import { startLive } from './live.js';
import { setupActions } from './actions.js';
import { makeCorrection } from './shared.js';
import { setupThread } from './thread.js';
import { setupTopicScreen } from './topicscreen.js';
import { setupPicker } from './picker.js';
import { setupBulk } from './bulk.js';
import { setupStatus, setupSettings, registerWorker } from './settings.js';
import { setupDrawer } from './drawer.js';
import { setupSystem } from './system.js';
import { setAccounts } from './tgbubble.js';
import { setupChatView } from './chatview.js';
import { setupTaskPanel } from './taskpanel.js';
import { chatOf } from './projection.js';

let topicScreen;
let picker;
let bulk;
let drawer;
let system;
let taskPanel;
let chatView; // { open(chat), close() } — one messenger chat in the feed (CONCEPT.md §8.2)

// The reset button shows how many tags filter the feed.
// «Дела» ⇄ «Сообщения» (CONCEPT.md §2.9); the choice is remembered on this device.
function setupModeToggle(feed) {
  const button = $('#mode-toggle');
  const show = (mode) => {
    button.textContent = mode === 'messages' ? 'Сообщения' : 'Дела';
    button.setAttribute('aria-label', mode === 'messages' ? 'Сейчас сообщения подряд. Показать дела' : 'Сейчас дела. Показать сообщения подряд');
  };
  let saved = 'cases';
  try { saved = localStorage.getItem('stream.feedMode') ?? 'cases'; } catch { /* private mode */ }
  feed.setMode(saved);
  show(saved);
  button.onclick = async () => {
    const next = feed.mode() === 'cases' ? 'messages' : 'cases';
    try { localStorage.setItem('stream.feedMode', next); } catch { /* private mode */ }
    show(next);
    await feed.setMode(next);
  };
}

function updateFilter() {
  const count = (feedRef?.tagFilter().length ?? 0) + (feedRef?.sourceFilter() ? 1 : 0);
  $('#filter-reset').hidden = !count;
  $('#filter-count').textContent = count ? String(count) : '';
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
    button.onclick = () => { notice.hidden = true; action.run(); };
  }
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, action ? 6000 : 4500);
}

function setupMessageActions(feed, composer, config) {
  const thread = setupThread({ getView: (id) => feed.view(id), getChain: (id) => feed.chain(id), openTopic: (id) => topicScreen.open(id) });
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
  // Rename a topic by hand: a correction on its first message.
  const topicDialog = $('#topic');
  let renaming;
  const renameTopic = (chain) => {
    renaming = chain;
    $('#topic-title').value = chain.named ? chain.title : '';
    $('#topic-title').placeholder = chain.title;
    $('#topic-hint').textContent = 'Без имени тема называется по первому сообщению.';
    topicDialog.showModal();
  };
  $('#topic-cancel').onclick = () => topicDialog.close();
  $('#topic-form').onsubmit = async (event) => {
    event.preventDefault();
    const title = $('#topic-title').value.trim();
    topicDialog.close();
    if (!title || !renaming || title === renaming.title) return;
    await composer.queue(makeCorrection(renaming.root, 'topic', { title })).catch((error) => notify(error.message));
  };
  topicScreen = setupTopicScreen({ feed, composer, onRename: renameTopic, onTaskCard: (id) => taskPanel.open(id) });
  picker = setupPicker({ getVisible: () => feed.visible(), getChain: (id) => feed.chain(id), notify });
  const link = (view, target) => composer.queue(makeCorrection(view.id, 'link', { target })).catch((error) => notify(error.message));
  // Connect a message to any other one chosen in the picker.
  const pickLink = (view) => picker.open({ exclude: view.id, onPick: async (target) => {
    await link(view, target.id);
    notify('Связано', { label: 'Отменить', run: () => correct(view, 'unlink') });
  } });
  bulk = setupBulk(feed, composer, { correct, link, pickLink, notify });
  chatView = setupChatView({ feed, composer, correct, notify });
  taskPanel = setupTaskPanel({ feed, composer, notify });
  system = setupSystem({ notify, onTrack: (messageId) => composer.queue(makeCorrection(messageId, 'track')).catch((error) => notify(error.message)) });
  drawer = setupDrawer({
    feed,
    onContact: (chat) => chatView.open(chat),
    onFilterChange: updateFilter,
  });
  setupActions({
    list: document.body, // the feed and the topic screen share the same message actions
    getView: (id) => feed.view(id),
    onAction: async (op, view) => {
      if (op === 'reply') composer.reply(view);
      else if (op === 'task') taskPanel.createFrom(view);
      else if (op === 'chat-open') chatView.open(chatOf(view.event));
      else if (op === 'system') system.open();
      else if (op === 'retry') { if (view.delivery?.action) system.retry(view.delivery.action); }
      else if (op === 'edit') composer.edit(view);
      else if (op === 'history') thread.open(view.id);
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
      else if (op === 'topic-open') topicScreen.open(view.id);
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
  // Chrome on Android: let the keyboard overlay the page so CSS can slide the layout instead of a jump resize.
  if ('virtualKeyboard' in navigator) navigator.virtualKeyboard.overlaysContent = true;
  const response = await fetch('/capture-config.json');
  if (!response.ok) throw new Error('Не удалось загрузить настройки приложения. Повторите запуск');
  const config = await response.json();
  setAccounts(config.telegram?.accounts);
  const onQueue = setupStatus();
  const feed = setupFeed({ notify, onQueue, limits: config, onOpenCase: (id) => topicScreen.openCase(id), onRender: () => { topicScreen?.render(); bulk?.repaint(); drawer?.render(); taskPanel?.render(); composerRef?.refreshTags(); } });
  feedRef = feed;
  const composer = setupComposer(config, { notify, onSent: () => feed.render({ bottom: true }), getViews: () => feed.views(),
    onPickRequest: () => picker.open({ onPick: (view) => composer.proceed(view) }) });
  composerRef = composer;
  setupModeToggle(feed);
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

  const mode = new URL(location.href).searchParams.get('mode');
  if (new URL(location.href).searchParams.has('shared')) feed.scrollToBottom();
  if (mode === 'voice') await composer.record();
  if (mode === 'text') composer.focus();
  if (mode === 'photo') { composer.openAttach(); notify('Выберите «Камера» или «Галерея»'); }
  navigator.storage?.persist?.().catch(() => {});
}

main().catch((error) => notify(`Не удалось открыть Stream. ${error.message}`));
