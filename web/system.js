// The System screen (CONCEPT.md §5): what works without the owner — Telegram bots, WhatsApp, the phone companion —
// its state (with the WhatsApp linking QR while it waits), the replies sent outside, and the chats switched off with
// «Не отслеживать».
import { getSetting } from './db.js';
import { accountTitle } from './tgbubble.js';
import { googleBox } from './googlebox.js';

const STATE = { ok: 'работает', silent: 'молчит', login_required: 'нужен вход', error: 'ошибка' };
const ACTION = { proposed: 'ждёт', approved: 'в очереди', running: 'отправляется', done: 'отправлено', failed: 'не отправлено', rejected: 'отменено' };
const clock = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The WhatsApp linking QR shows only while the channel waits for linking: a stale `info.qr` left by a channel that
// was switched off or linked must not draw it.
export const showsQr = (item) => item.state === 'login_required' && Boolean(item.info?.qr) && String(item.source).startsWith('whatsapp_');
// After asking for the QR: 'show' it; a miss right after drawing is waited for (the timer asks again) — redrawing at
// once would loop; a miss on the timer redraws the screen once (linked meanwhile, or a new QR is being prepared).
export const qrNext = (status, fromTimer) => status === 200 ? 'show' : status === 404 && fromTimer ? 'refresh' : 'wait';

export function ago(iso, now = Date.now()) {
  if (!iso) return 'никогда';
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} ч назад`;
  return clock.format(new Date(iso));
}

export function setupSystem({ notify, onTrack }) {
  const dialog = document.querySelector('#system');
  const sources = document.querySelector('#system-sources');
  const actions = document.querySelector('#system-actions');
  const exclusions = document.querySelector('#system-exclusions');
  const telegramBox = document.querySelector('#system-telegram');
  const googleSlot = document.querySelector('#system-google');

  async function call(path, init = {}) {
    const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${await getSetting('ownerToken')}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (!response.ok) throw new Error(response.status === 401 ? 'Токен не принят' : 'Сервер недоступен');
    return response.status === 204 ? null : response.json();
  }

  function sourceRow(item) {
    const row = element('div', 'system-source');
    row.append(element('span', `system-dot ${item.state}`), element('span', 'system-name', `${item.title} — ${STATE[item.state] ?? item.state}`));
    const facts = [];
    if (item.pulse_at) facts.push(`сигнал ${ago(item.pulse_at)}`);
    facts.push(`последнее сообщение ${ago(item.last_event_at)}`);
    if (item.info?.chats !== undefined) facts.push(`чатов ${item.info.chats}, групп ${item.info.groups}, отключено ${item.info.excluded}`);
    if (item.failed_24h) facts.push(`не отправлено за сутки: ${item.failed_24h}`);
    const detail = element('span', 'system-detail', facts.join(' · '));
    if (item.detail && item.state !== 'ok') detail.append(element('div', '', item.detail));
    row.append(detail);
    if (showsQr(item)) row.append(qrBlock(item));
    return row;
  }

  // WhatsApp linking (deploy/WHATSAPP.md): the QR needs the owner token, so it is fetched and shown as a blob (the
  // page's CSP allows blob: images, not data:); WhatsApp changes it every few seconds while it waits.
  const qrTimers = new Set();
  const qrUrls = new Set();
  function stopQr() {
    for (const timer of qrTimers) clearInterval(timer);
    qrTimers.clear();
    for (const url of qrUrls) URL.revokeObjectURL(url);
    qrUrls.clear();
  }
  function qrBlock(item) {
    const account = item.source.slice('whatsapp_'.length);
    const box = element('div', 'system-qr');
    const image = element('img');
    image.alt = 'QR для привязки WhatsApp';
    box.append(image, element('div', 'system-detail', 'На телефоне: WhatsApp → Связанные устройства → Привязать устройство'));
    const load = async (fromTimer) => {
      try {
        const response = await fetch(`/api/whatsapp/${account}/qr`, { headers: { Authorization: `Bearer ${await getSetting('ownerToken')}` }, cache: 'no-store' });
        const next = qrNext(response.status, fromTimer);
        if (next === 'refresh') { render(); return; }
        if (next === 'wait') { image.hidden = true; return; }   // a new QR is on its way: the timer asks again
        const url = URL.createObjectURL(await response.blob());
        const old = image.src;
        image.src = url;
        image.hidden = false;
        qrUrls.add(url);
        if (old) { URL.revokeObjectURL(old); qrUrls.delete(old); }
      } catch { /* offline: the next refresh tries again */ }
    };
    void load(false);
    qrTimers.add(setInterval(() => { if (dialog.open) void load(true); else stopQr(); }, (item.info.qr_refresh_s ?? 15) * 1000));
    return box;
  }

  function actionRow(action) {
    const row = element('div', 'system-row');
    row.append(element('span', '', `${action.params?.text ?? action.operation}`));
    row.title = action.error ?? '';
    row.append(element('span', `state ${action.status}`, `${ACTION[action.status] ?? action.status} · ${ago(action.updated_at)}`));
    if (action.status === 'failed') {
      const retry = element('button', 'link-button', 'Повторить');
      retry.type = 'button';
      retry.onclick = () => retryAction(action.id);
      row.append(retry);
    }
    return row;
  }

  // Accounts connected to the bots (CONCEPT.md §8.2): only trusted ones are read and answered.
  function connectionRow(item) {
    const row = element('div', 'system-row connection');
    const state = item.trusted === true ? (item.enabled ? 'принято' : 'бот отключён в Telegram') : item.trusted === false ? 'отклонено' : 'ждёт решения';
    row.append(element('span', '', `${accountTitle(item.account)} · ${item.user_name ?? item.user_id}`), element('span', `state ${item.trusted === false ? 'failed' : ''}`, state));
    const decide = (label, trusted) => {
      const button = element('button', 'link-button', label);
      button.type = 'button';
      button.onclick = async () => {
        try { await call('/api/telegram/trust', { method: 'POST', body: JSON.stringify({ account: item.account, user_id: item.user_id, trusted }) }); render(); }
        catch (error) { notify(error.message); }
      };
      return button;
    };
    if (item.trusted !== true) row.append(decide('Принять', true));
    if (item.trusted !== false) row.append(decide(item.trusted ? 'Отключить' : 'Отклонить', false));
    return row;
  }

  function telegramRows(data) {
    const rows = [];
    for (const [account, username] of Object.entries(data.bots ?? {})) {
      rows.push(element('p', 'system-detail', `${accountTitle(account)}: бот @${username ?? '…'} — подключите его в Telegram: Настройки → Telegram для бизнеса → Чат-боты`));
    }
    rows.push(...(data.connections ?? []).map(connectionRow));
    const groups = (data.groups ?? []).filter((group) => group.member);
    if (groups.length) rows.push(element('p', 'system-detail', `Группы: ${groups.map((group) => `${group.title ?? group.chat_id} (${accountTitle(group.account)}${group.allowed ? '' : ', не читается'})`).join(', ')}`));
    return rows.length ? rows : [element('p', 'system-empty', 'Боты Telegram не настроены — см. deploy/TELEGRAM.md')];
  }

  function exclusionRow(item) {
    const row = element('div', 'system-row');
    row.append(element('span', '', item.chat_title || item.chat_id));
    const back = element('button', 'link-button', 'Вернуть');
    back.type = 'button';
    back.onclick = async () => { await onTrack(item.message); notify('Чат снова отслеживается: шлюз подтянет сегодняшние сообщения'); render(); };
    row.append(back);
    return row;
  }

  async function retryAction(id) {
    try { await call(`/api/actions/${id}/retry`, { method: 'POST' }); notify('Отправка повторится'); render(); }
    catch (error) { notify(error.message); }
  }

  async function render() {
    try {
      const data = await call('/api/system');
      stopQr();
      sources.replaceChildren(...data.sources.map(sourceRow));
      telegramBox.replaceChildren(...telegramRows(data.telegram ?? {}));
      googleSlot.replaceChildren(...await googleBox({ call, notify, rerender: render }));
      actions.replaceChildren(...(data.actions.length ? data.actions.map(actionRow) : [element('p', 'system-empty', 'Ответов наружу ещё не было')]));
      exclusions.replaceChildren(...(data.exclusions.length ? data.exclusions.map(exclusionRow) : [element('p', 'system-empty', 'Все чаты отслеживаются')]));
    } catch (error) {
      sources.replaceChildren(element('p', 'system-empty', `${error.message}. Экран «Система» работает только в сети`));
    }
  }

  document.querySelector('#system-close').onclick = () => dialog.close();
  dialog.addEventListener('close', stopQr);
  document.querySelector('#system-refresh').onclick = render;
  return { open: () => { dialog.showModal(); render(); }, retry: retryAction };
}
