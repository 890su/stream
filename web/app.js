import { getSetting, setSetting } from './db.js';
import { setupComposer } from './composer.js';
import { setupFeed } from './feed.js';
import { startSync, synchronize } from './outbox.js';
import { startLive } from './live.js';
import { setupActions } from './actions.js';
import { makeCorrection } from './shared.js';
import { setupThread } from './thread.js';
import { setupTopicScreen } from './topicscreen.js';
import { setupPicker } from './picker.js';
import { setupSelection } from './select.js';
import { setupDrawer } from './drawer.js';

let topicScreen;
let picker;
let bulk;
let drawer;

// The reset button shows how many tags filter the feed.
function updateFilter() {
  const count = feedRef?.tagFilter().length ?? 0;
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

// Bulk actions on selected messages (select.js). Each one is ordinary corrections, so undo works as usual.
function setupBulk(feed, composer, { correct, link, pickLink }) {
  const each = (views, op) => Promise.all(views.map((view) => correct(view, op)));
  // The tag row acts on the selection: link (one topic, or the picker for one message), unlink, toggle a tag.
  let selection;
  const linkAll = async (views) => {
    if (views.length === 1) { selection.leave(); pickLink(views[0]); return; }
    const changed = views.slice(1).filter((view, index) => view.continues !== views[index].id);
    await Promise.all(changed.map((view) => link(view, views[views.indexOf(view) - 1].id)));
    selection.leave();
    notify(`Связано в одну тему: ${views.length}`, { label: 'Отменить', run: () => each(changed, 'unlink') });
  };
  const unlinkAll = async (views) => {
    const linked = views.filter((view) => view.continues);
    if (!linked.length) { notify('Выбранные ни к чему не привязаны'); return; }
    const targets = linked.map((view) => [view, view.continues]);
    await each(linked, 'unlink');
    selection.leave();
    notify(`Отвязано: ${linked.length}`, { label: 'Отменить', run: () => Promise.all(targets.map(([view, target]) => link(view, target))) });
  };
  const toggleTag = async (views, tag) => {
    const all = views.every((view) => view.tags.includes(tag));
    const targets = all ? views : views.filter((view) => !view.tags.includes(tag));
    await Promise.all(targets.map((view) => composer.queue(makeCorrection(view.id, 'edit',
      { text: view.text, tags: all ? view.tags.filter((item) => item !== tag) : [...view.tags, tag] }))));
  };
  selection = setupSelection({
    getView: (id) => feed.view(id),
    onChange: (views) => composer.selectionTags(views && {
      link: () => linkAll(selection.selected()),
      unlink: () => unlinkAll(selection.selected()),
      toggleTag: (tag) => toggleTag(selection.selected(), tag),
      stateOf: (tag) => selection.selected().every((view) => view.tags.includes(tag)),
    }),
    actions: {
      copy: async (views) => {
        try { await navigator.clipboard.writeText(views.map((view) => view.text).filter(Boolean).join(String.fromCharCode(10, 10))); notify(`Скопировано: ${views.length}`); }
        catch { notify('Не удалось скопировать: браузер не дал доступ к буферу обмена'); }
      },
      archive: async (views) => { await each(views, 'archive'); notify(`В архиве: ${views.length}`, { label: 'Вернуть', run: () => each(views, 'unarchive') }); },
      delete: async (views) => { await each(views, 'delete'); notify(`Удалено: ${views.length}`, { label: 'Отменить', run: () => each(views, 'restore') }); },
    },
  });
  return selection;
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
  topicScreen = setupTopicScreen({ feed, composer, onRename: renameTopic });
  picker = setupPicker({ getVisible: () => feed.visible(), getChain: (id) => feed.chain(id), notify });
  const link = (view, target) => composer.queue(makeCorrection(view.id, 'link', { target })).catch((error) => notify(error.message));
  // Connect a message to any other one chosen in the picker.
  const pickLink = (view) => picker.open({ exclude: view.id, onPick: async (target) => {
    await link(view, target.id);
    notify('Связано', { label: 'Отменить', run: () => correct(view, 'unlink') });
  } });
  bulk = setupBulk(feed, composer, { correct, link, pickLink });
  drawer = setupDrawer({
    feed,
    onJump: (id) => feed.jump(id),
    onArchiveTopic: async (topic) => {
      const root = feed.view(topic.root);
      const op = topic.archived ? 'topic_unarchive' : 'topic_archive';
      await correct(root, op);
      notify(topic.archived ? 'Тема возвращена из архива' : 'Тема в архиве', { label: 'Отменить', run: () => correct(root, topic.archived ? 'topic_archive' : 'topic_unarchive') });
    },
    onFilterChange: updateFilter,
  });
  setupActions({
    list: document.body, // the feed and the topic screen share the same message actions
    getView: (id) => feed.view(id),
    onAction: async (op, view) => {
      if (op === 'reply') composer.reply(view);
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

function plural(count, one, few, many) {
  const mod10 = count % 10, mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

function setupStatus() {
  const line = $('#network');
  const queueCount = $('#queue-count');
  let queue = { total: 0, failed: 0 };
  const update = () => {
    const { total, failed } = queue;
    const waiting = `${total} ${plural(total, 'запись ждёт', 'записи ждут', 'записей ждут')}`;
    line.classList.toggle('online', navigator.onLine && !total);
    line.textContent = !navigator.onLine ? (total ? `нет сети · ${waiting} на телефоне` : 'нет сети · записи сохранятся на телефоне')
      : failed ? `не отправлено: ${failed}` : total ? `отправка… ${waiting}` : 'в сети';
    queueCount.textContent = total ? `На телефоне: ${waiting} отправки.` : 'Все записи отправлены.';
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
  return (next) => { queue = next; update(); };
}

async function setupSettings(config, feed, onToken) {
  const dialog = $('#settings');
  // "Show archived" in the top bar: archived messages and topics, in the feed and in the drawer. Off by default.
  const archive = $('#archive-toggle');
  const showArchive = async (on) => {
    archive.setAttribute('aria-pressed', String(on));
    archive.setAttribute('aria-label', on ? 'Скрыть архив' : 'Показывать архив');
    await feed.setShowArchive(on);
    drawer?.render();
  };
  if (await getSetting('showArchive')) await showArchive(true);
  archive.onclick = async () => { const on = archive.getAttribute('aria-pressed') !== 'true'; await setSetting('showArchive', on); await showArchive(on); };
  // Tag filter reset, shown while the feed is filtered (drawer.js).
  $('#filter-reset').onclick = async () => { await feed.setTagFilter([]); updateFilter(); drawer?.render(); };
  const input = $('#owner-token');
  input.minLength = config.min_owner_token_length;
  $('#menu-button').onclick = () => dialog.showModal();
  $('#settings-close').onclick = () => dialog.close();
  $('#token-form').onsubmit = async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (value.length < config.min_owner_token_length) { notify(`Токен должен быть не короче ${config.min_owner_token_length} символов`); return; }
    try {
      await setSetting('ownerToken', value);
      input.value = '';
      dialog.close();
      notify('Токен сохранён на этом телефоне');
      onToken();
      await synchronize();
      await feed.refresh();
    } catch (error) { notify(error.message); }
  };
  if (!(await getSetting('ownerToken'))) dialog.showModal();
}

async function registerWorker(feed, composer) {
  if (!('serviceWorker' in navigator)) return;
  // A new version takes over at once (skipWaiting); reload into it unless the owner is in the middle of something.
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (composer.busy()) notify('Stream обновлён. Новая версия откроется после отправки');
    else location.reload();
  });
  navigator.serviceWorker.addEventListener('message', () => {
    synchronize().catch((error) => notify(error.message)).finally(() => feed.render({ bottom: true }));
  });
  // A failed registration must not stop the outbox: queued entries still sync while the page is open.
  try {
    // updateViaCache 'none': update checks never trust an HTTP or CDN cache.
    const registration = await navigator.serviceWorker.register('/sw.js', { type: 'module', updateViaCache: 'none' });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) registration.update().catch(() => {}); });
  } catch (error) {
    notify(`Офлайн-режим и «Поделиться» недоступны: ${error.message}. Записи отправляются, пока Stream открыт`);
  }
}

async function main() {
  // Chrome on Android: let the keyboard overlay the page so CSS can slide the layout instead of a jump resize.
  if ('virtualKeyboard' in navigator) navigator.virtualKeyboard.overlaysContent = true;
  const response = await fetch('/capture-config.json');
  if (!response.ok) throw new Error('Не удалось загрузить настройки приложения. Повторите запуск');
  const config = await response.json();
  const onQueue = setupStatus();
  const feed = setupFeed({ notify, onQueue, limits: config, onRender: () => { topicScreen?.render(); bulk?.repaint(); drawer?.render(); composerRef?.refreshTags(); } });
  feedRef = feed;
  const composer = setupComposer(config, { notify, onSent: () => feed.render({ bottom: true }), getViews: () => feed.views(),
    onPickRequest: () => picker.open({ onPick: (view) => composer.proceed(view) }) });
  composerRef = composer;
  setupMessageActions(feed, composer, config);
  window.addEventListener('queue-change', () => feed.render().catch((error) => notify(error.message)));
  const live = startLive({
    getToken: () => getSetting('ownerToken'),
    onEvent: (event) => feed.receive(event).then(() => composer.refreshTags()).catch((error) => notify(error.message)),
    onConnect: () => feed.refresh(),
  });
  await setupSettings(config, feed, () => live.reconnect());
  await registerWorker(feed, composer);
  startSync(config, notify);
  await feed.refresh();
  composer.refreshTags(); // frequent tags are known once the feed is loaded
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
