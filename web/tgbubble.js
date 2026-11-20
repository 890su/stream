// Telegram messages in the feed (CONCEPT.md §8.2): the header «Telegram BY · имя», forwards, files that were
// not downloaded, and the delivery state of a reply sent from the feed. Labels are pure (tested in node);
// the blocks build DOM. User content goes in through textContent only.

let accounts = {}; // account -> { title }, from /capture-config.json

export function setAccounts(map) { accounts = map ?? {}; }
export const accountTitle = (account) => account === 'viber' ? 'Viber' : accounts[account]?.title ?? `Telegram ${String(account).toUpperCase()}`;
export const accountKeys = () => Object.keys(accounts);
export const isMessenger = (event) => Boolean(event?.payload?.data?.telegram || event?.payload?.data?.viber || event?.payload?.data?.outbound);

const SKIPPED = { too_large: 'слишком большой', unsupported: 'формат не сохраняется', failed: 'не скачался' };
const DELIVERY = { proposed: 'ждёт подтверждения', approved: 'отправляется…', running: 'отправляется…', done: '✓ в Telegram', failed: 'не отправлено', rejected: 'отменено' };
const DONE_IN = { viber: '✓ в Viber' };

function sizeLabel(bytes) {
  if (!bytes) return '';
  return bytes < 1024 * 1024 ? ` ${Math.max(1, Math.round(bytes / 1024))} КБ` : ` ${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function fileWord(mime = '') {
  return mime.startsWith('video/') ? 'Видео' : mime.startsWith('audio/') ? 'Аудио' : mime.startsWith('image/') ? 'Фото' : 'Файл';
}

// { head, incoming, outbound, forward, skipped, chat } for a Telegram message or a reply sent to Telegram.
export function messengerLabel(event) {
  const data = event?.payload?.data ?? {};
  if (data.outbound) {
    const account = data.outbound.connector.replace(/^telegram_/, '');
    return { head: `→ ${accountTitle(account)} · ${data.outbound.chat_title || 'чат'}`, incoming: false, outbound: true, forward: null, skipped: null };
  }
  if (data.viber) {
    const v = data.viber;
    return { head: `Viber · ${v.chat}${v.phone && v.phone !== v.chat ? ` · ${v.phone}` : ''}`, incoming: event.author !== 'me', outbound: false, forward: null, skipped: null };
  }
  const t = data.telegram;
  if (!t) return null;
  const chat = t.chat_title || t.from_name || 'чат';
  const author = t.chat_type === 'group' && event.author !== 'me' && t.from_name ? ` · ${t.from_name}` : '';
  const forward = t.forward ? `Переслано${t.forward.from_name ? ` от ${t.forward.from_name}` : ''}` : null;
  const skipped = t.media_skipped
    ? `${fileWord(t.media_skipped.mime)}${t.media_skipped.name ? ` «${t.media_skipped.name}»` : ''}${sizeLabel(t.media_skipped.size_bytes)} — ${SKIPPED[t.media_skipped.reason] ?? 'не скачан'}`
    : null;
  return { head: `${accountTitle(t.account)} · ${chat}${author}`, incoming: event.author !== 'me', outbound: false, forward, skipped };
}

export const deliveryText = (delivery) => (delivery?.status === 'done' && DONE_IN[delivery.connector]) || DELIVERY[delivery?.status] || '';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The header of a messenger bubble. A tap on the chat name shows the whole chat (data-chat-open, app.js).
export function messengerBlock(view) {
  const label = messengerLabel(view.event);
  const box = element('div', 'tg-block');
  const head = element('button', 'tg-head', label.head);
  head.type = 'button';
  head.dataset.chatOpen = '';
  head.setAttribute('aria-label', `Показать переписку: ${label.head}`);
  box.append(head);
  if (label.forward) box.append(element('div', 'tg-forward', label.forward));
  if (label.skipped) box.append(element('div', 'tg-skipped', label.skipped));
  return box;
}

// Under a reply sent to Telegram: its delivery, with «Повторить» when it failed.
export function deliveryLine(view) {
  const line = element('div', `tg-delivery ${view.delivery.status}`, deliveryText(view.delivery));
  if (view.delivery.status === 'failed') {
    if (view.delivery.error) line.title = view.delivery.error;
    if (view.delivery.action) {
      const retry = element('button', 'link-button', 'Повторить');
      retry.type = 'button';
      retry.dataset.retry = view.delivery.action;
      line.append(' · ', retry);
    }
  }
  return line;
}
