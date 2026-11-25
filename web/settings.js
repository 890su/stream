// Top-bar status line (network and outbox), the settings dialog (owner token and copying it to another device,
// quiet days before a read conversation is archived, archive toggle, filter reset,
// System screen button) and the service worker registration with update handling.
import { getSetting, setSetting } from './db.js';
import { synchronize } from './outbox.js';

const $ = (selector) => document.querySelector(selector);

function plural(count, one, few, many) {
  const mod10 = count % 10, mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

export function setupStatus() {
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

export async function setupSettings(config, feed, onToken, { notify, drawer, system, updateFilter }) {
  const dialog = $('#settings');
  // "Show archived" in the top bar: archived messages and topics, in the feed and in the drawer. Off by default.
  const archive = $('#archive-toggle');
  const showArchive = async (on) => {
    archive.setAttribute('aria-pressed', String(on));
    archive.setAttribute('aria-label', on ? 'Скрыть архив' : 'Показывать архив');
    await feed.setShowArchive(on);
    drawer()?.render();
  };
  if (await getSetting('showArchive')) await showArchive(true);
  archive.onclick = async () => { const on = archive.getAttribute('aria-pressed') !== 'true'; await setSetting('showArchive', on); await showArchive(on); };
  // Tag filter reset, shown while the feed is filtered (drawer.js).
  $('#filter-reset').onclick = async () => { await feed.setSourceFilter(null); await feed.setTagFilter([]); updateFilter(); drawer()?.render(); };
  $('#system-button').onclick = () => { dialog.close(); system().open(); };
  const input = $('#owner-token');
  input.minLength = config.min_owner_token_length;
  // Moving to another device (a computer): copy this device's token; it is never shown on screen.
  const copy = $('#token-copy');
  copy.hidden = !(await getSetting('ownerToken'));
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(await getSetting('ownerToken')); notify('Токен скопирован. На другом устройстве: ⋮ → Доступ → вставьте → «Сохранить»'); }
    catch { notify('Не удалось скопировать: браузер не дал доступ к буферу обмена'); }
  };
  // Quiet days before a read conversation leaves the queue (CONCEPT.md §2.5). Saved on the server, then redrawn.
  const days = $('#archive-read-days');
  const savedDays = () => (Number.isInteger(config.conversations?.queue?.archive_read_days) ? config.conversations.queue.archive_read_days : 3);
  days.value = String(savedDays());
  days.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); days.blur(); } };
  days.onchange = async () => {
    const raw = days.value.trim();
    const value = Number(raw);
    if (raw === '' || !Number.isInteger(value) || value < 0 || value > 30) { notify('Нужно число дней от 0 до 30'); days.value = String(savedDays()); return; }
    try {
      const response = await fetch('/api/settings/archive-read-days', { method: 'POST', body: JSON.stringify({ value }),
        headers: { Authorization: `Bearer ${await getSetting('ownerToken')}`, 'Content-Type': 'application/json' } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Не удалось сохранить');
      config.conversations = { ...config.conversations, queue: { ...config.conversations?.queue, archive_read_days: value } };
      await feed.render();
    } catch (error) { notify(error.message); days.value = String(savedDays()); }
  };
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
      copy.hidden = false;
      notify('Токен сохранён на этом устройстве');
      onToken();
      await synchronize();
      await feed.refresh();
    } catch (error) { notify(error.message); }
  };
  if (!(await getSetting('ownerToken'))) dialog.showModal();
}

export async function registerWorker(feed, composer, notify) {
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
