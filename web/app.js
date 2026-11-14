import { getSetting, setSetting } from './db.js';
import { setupComposer } from './composer.js';
import { setupFeed } from './feed.js';
import { startSync, synchronize } from './outbox.js';
import { startLive } from './live.js';
import { setupActions } from './actions.js';
import { makeCorrection } from './shared.js';
import { setupThread } from './thread.js';

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

function setupMessageActions(feed, composer) {
  const thread = setupThread({ getViews: () => feed.views() });
  // Photos are thumbnails in the feed; a tap opens them full size.
  const viewer = $('#viewer');
  $('#viewer-close').onclick = () => viewer.close();
  viewer.addEventListener('click', (event) => { if (event.target === viewer || event.target.id === 'viewer-image') viewer.close(); });
  $('#feed-list').addEventListener('click', (event) => {
    const image = event.target.closest('[data-viewer]');
    if (!image?.src) return;
    $('#viewer-image').src = image.src;
    $('#viewer-image').alt = image.alt;
    viewer.showModal();
  });
  const correct = (view, op) => composer.queue(makeCorrection(view.id, op)).catch((error) => notify(error.message));
  const link = (view, target) => composer.queue(makeCorrection(view.id, 'link', { target })).catch((error) => notify(error.message));
  setupActions({
    list: $('#feed-list'),
    getView: (id) => feed.view(id),
    onAction: async (op, view) => {
      if (op === 'reply') composer.reply(view);
      else if (op === 'edit') composer.edit(view);
      else if (op === 'history') thread.open(view.id);
      else if (op === 'continue') composer.proceed(view);
      else if (op === 'link') {
        if (view.continues) { await correct(view, 'unlink'); notify('Отделено от предыдущего', { label: 'Отменить', run: () => link(view, view.continues) }); return; }
        const previous = feed.previous(view.id);
        if (!previous) { notify('Выше нет сообщения, с которым можно связать'); return; }
        await link(view, previous.id);
        notify('Связано с предыдущим', { label: 'Отменить', run: () => correct(view, 'unlink') });
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
  const archive = $('#show-archive');
  archive.checked = Boolean(await getSetting('showArchive'));
  if (archive.checked) await feed.setShowArchive(true);
  archive.onchange = async () => { await setSetting('showArchive', archive.checked); await feed.setShowArchive(archive.checked); };
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
  const feed = setupFeed({ notify, onQueue, limits: config });
  const composer = setupComposer(config, { notify, onSent: () => feed.render({ bottom: true }), getViews: () => feed.views(), getLatest: () => feed.latest() });
  setupMessageActions(feed, composer);
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
