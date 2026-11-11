import { getSetting, setSetting } from './db.js';
import { setupCapture } from './capture.js';
import { setupFeed } from './feed.js';
import { startSync, synchronize } from './outbox.js';

const notice = document.querySelector('#notice');
function notify(message) { notice.textContent = message; }

async function main() {
  const response = await fetch('/capture-config.json');
  if (!response.ok) throw new Error('Не удалось загрузить настройки приложения. Повторите запуск');
  const config = await response.json();
  const feed = setupFeed(notify);
  const capture = setupCapture(config, notify);
  const settings = document.querySelector('#settings');
  const tokenInput = document.querySelector('#owner-token');
  tokenInput.minLength = config.min_owner_token_length;
  const token = await getSetting('ownerToken');
  settings.open = !token;
  document.querySelector('#token-form').onsubmit = async (event) => {
    event.preventDefault();
    const value = tokenInput.value.trim();
    if (value.length < config.min_owner_token_length) { notify(`Введите токен владельца длиной минимум ${config.min_owner_token_length} символа`); return; }
    try {
      await setSetting('ownerToken', value);
      tokenInput.value = '';
      settings.open = false;
      notify('Токен сохранён на устройстве');
      await synchronize(); await feed.refresh();
    } catch (error) { notify(error.message); }
  };
  const show = (view) => {
    document.querySelector('#capture-view').hidden = view !== 'capture';
    document.querySelector('#feed-view').hidden = view !== 'feed';
    for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
    if (view === 'feed') feed.refresh().catch((error) => notify(error.message));
  };
  for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => show(button.dataset.view);
  document.querySelector('#sync-now').onclick = async () => {
    try { await synchronize(); await feed.refresh(); } catch (error) { notify(error.message); }
  };
  const network = () => { document.querySelector('#network').textContent = navigator.onLine ? 'В сети' : 'Без сети · записи сохраняются на устройстве'; };
  network(); window.addEventListener('online', network); window.addEventListener('offline', network);
  window.addEventListener('queue-change', () => feed.render().catch((error) => notify(error.message)));
  navigator.serviceWorker?.addEventListener('message', () => { show('feed'); synchronize().catch((error) => notify(error.message)); });
  // A failed registration must not stop the outbox: queued entries still sync while the page is open.
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { type: 'module' });
      if (registration.waiting) notify('Доступно обновление. Закройте все окна Stream и откройте заново');
    } catch (error) {
      notify(`Офлайн-режим и «Поделиться» недоступны: ${error.message}. Записи отправляются, пока приложение открыто`);
    }
  }
  startSync(config, notify);
  await feed.refresh();
  setInterval(() => { if (!document.hidden) feed.refresh().catch((error) => notify(error.message)); }, config.feed_refresh_ms);
  const query = new URL(location.href).searchParams;
  if (query.has('shared')) show('feed');
  if (query.get('mode') === 'voice') await capture.record();
  if (query.get('mode') === 'text') document.querySelector('#message').focus();
  if (query.get('mode') === 'photo') { document.querySelector('#photo').focus(); notify('Нажмите «Сделать фото»'); }
  navigator.storage?.persist?.().catch(() => {});
}

main().catch((error) => notify(`Не удалось открыть Stream. ${error.message}`));
