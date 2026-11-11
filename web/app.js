import { getSetting, setSetting } from './db.js';
import { setupComposer } from './composer.js';
import { setupFeed } from './feed.js';
import { startSync, synchronize } from './outbox.js';

const $ = (selector) => document.querySelector(selector);
const notice = $('#notice');
let noticeTimer;

function notify(message) {
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 4500);
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

async function setupSettings(config, feed) {
  const dialog = $('#settings');
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
      await synchronize();
      await feed.refresh();
    } catch (error) { notify(error.message); }
  };
  if (!(await getSetting('ownerToken'))) dialog.showModal();
}

async function registerWorker(feed) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', () => {
    synchronize().catch((error) => notify(error.message)).finally(() => feed.render({ bottom: true }));
  });
  // A failed registration must not stop the outbox: queued entries still sync while the page is open.
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { type: 'module' });
    if (registration.waiting) notify('Доступно обновление. Закройте Stream и откройте снова');
  } catch (error) {
    notify(`Офлайн-режим и «Поделиться» недоступны: ${error.message}. Записи отправляются, пока Stream открыт`);
  }
}

async function main() {
  const response = await fetch('/capture-config.json');
  if (!response.ok) throw new Error('Не удалось загрузить настройки приложения. Повторите запуск');
  const config = await response.json();
  const onQueue = setupStatus();
  const feed = setupFeed({ notify, onQueue });
  const composer = setupComposer(config, { notify, onSent: () => feed.render({ bottom: true }) });
  window.addEventListener('queue-change', () => feed.render().catch((error) => notify(error.message)));
  await setupSettings(config, feed);
  await registerWorker(feed);
  startSync(config, notify);
  await feed.refresh();
  setInterval(() => { if (!document.hidden) feed.refresh(); }, config.feed_refresh_ms);

  const mode = new URL(location.href).searchParams.get('mode');
  if (new URL(location.href).searchParams.has('shared')) feed.scrollToBottom();
  if (mode === 'voice') await composer.record();
  if (mode === 'text') composer.focus();
  if (mode === 'photo') { composer.openAttach(); notify('Выберите «Камера» или «Галерея»'); }
  navigator.storage?.persist?.().catch(() => {});
}

main().catch((error) => notify(`Не удалось открыть Stream. ${error.message}`));
