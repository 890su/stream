// The System screen (CONCEPT.md §5; by cards since 2026-11-21): every connection as a card — channels and services,
// what needs attention on top — with its state, an on/off switch and, opened, what belongs to it: keys (keysbox.js),
// the WhatsApp linking QR, the accounts connected to a Telegram bot, Google's accounts and calendars (googlebox.js),
// its failed sends. Below — the journal: all sends outside and the chats switched off with «Не отслеживать».
import { getSetting } from './db.js';
import { accountTitle } from './tgbubble.js';
import { googleBox } from './googlebox.js';
import { keyRows } from './keysbox.js';
import { systemGroups, card, aiStatsLines, triageModeChoice } from './systemcards.js';

const ACTION = { proposed: 'ждёт', approved: 'в очереди', running: 'отправляется', done: 'отправлено', failed: 'не отправлено', rejected: 'отменено' };
const clock = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(className, text, onClick) {
  const node = element('button', className, text);
  node.type = 'button';
  node.onclick = onClick;
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
  const body = document.querySelector('#system-body');
  const opened = new Set(); // cards the owner opened, kept across redraws
  let triageMode = null; // the AI mode just chosen here, before the triage reports it (src/ownersettings.ts)

  async function call(path, init = {}) {
    const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${await getSetting('ownerToken')}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (!response.ok) {
      const said = response.status === 401 ? null : await response.json().then((data) => data?.error, () => null);
      throw new Error(response.status === 401 ? 'Токен не принят' : said ? said.replace(/^\d{3} /, '') : 'Сервер недоступен');
    }
    return response.status === 204 ? null : response.json();
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

  async function retryAction(id) {
    try { await call(`/api/actions/${id}/retry`, { method: 'POST' }); notify('Отправка повторится'); render(); }
    catch (error) { notify(error.message); }
  }

  function actionRow(action) {
    const row = element('div', 'system-row');
    row.append(element('span', '', `${action.params?.text ?? action.operation}`));
    row.title = action.error ?? '';
    row.append(element('span', `state ${action.status}`, `${ACTION[action.status] ?? action.status} · ${ago(action.updated_at)}`));
    if (action.status === 'failed') row.append(button('link-button', 'Повторить', () => retryAction(action.id)));
    return row;
  }

  // Accounts connected to a bot (CONCEPT.md §8.2): only trusted ones are read and answered.
  function connectionRow(item) {
    const row = element('div', 'system-row connection');
    const state = item.trusted === true ? (item.enabled ? 'принято' : 'бот отключён в Telegram') : item.trusted === false ? 'отклонено' : 'ждёт решения';
    row.append(element('span', '', item.user_name ?? item.user_id), element('span', `state ${item.trusted === false ? 'failed' : ''}`, state));
    const decide = (label, trusted) => button('link-button', label, async () => {
      try { await call('/api/telegram/trust', { method: 'POST', body: JSON.stringify({ account: item.account, user_id: item.user_id, trusted }) }); render(); }
      catch (error) { notify(error.message); }
    });
    if (item.trusted !== true) row.append(decide('Принять', true));
    if (item.trusted !== false) row.append(decide(item.trusted ? 'Отключить' : 'Отклонить', false));
    return row;
  }

  function exclusionRow(item) {
    const row = element('div', 'system-row');
    row.append(element('span', '', item.chat_title || item.chat_id),
      button('link-button', 'Вернуть', async () => { await onTrack(item.message); notify('Чат снова отслеживается: шлюз подтянет сегодняшние сообщения'); render(); }));
    return row;
  }

  const section = (title, nodes) => [element('p', 'picker-section', title), ...nodes];
  const fold = (title, nodes, empty) => {
    const box = element('details', 'system-journal');
    box.append(Object.assign(element('summary', 'picker-section'), { textContent: title }), ...(nodes.length ? nodes : [element('p', 'system-empty', empty)]));
    return box;
  };

  // What one card shows inside: its keys, its own things, its failed sends.
  function cardBody(item, data) {
    return async () => {
      const ctx = { call, notify, rerender: render };
      const nodes = [];
      const account = item.source.startsWith('telegram_') ? item.source.slice(9) : null;
      if (account) {
        nodes.push(...await keyRows([`telegram:${account}`], ctx));
        const bot = data.telegram?.bots?.[account];
        if (bot !== undefined) nodes.push(element('p', 'system-detail', `Бот @${bot ?? '…'} — подключите его в Telegram: Настройки → Telegram для бизнеса → Чат-боты.`));
        const people = (data.telegram?.connections ?? []).filter((connection) => connection.account === account);
        if (people.length) nodes.push(...section('Подключённые аккаунты', people.map(connectionRow)));
        const groups = (data.telegram?.groups ?? []).filter((group) => group.member && group.account === account);
        if (groups.length) nodes.push(element('p', 'system-detail', `Группы: ${groups.map((group) => `${group.title ?? group.chat_id}${group.allowed ? '' : ' (не читается)'}`).join(', ')}`));
      }
      if (item.source === 'google_calendar') nodes.push(...await googleBox(ctx));
      if (item.source === 'ai_triage') {
        nodes.push(...await keyRows(['ai'], ctx));
        // «Новые задачи»: the triage reports its mode on its next pass; the choice just made shows at once.
        const chips = element('div', 'chips');
        for (const option of triageModeChoice(triageMode ?? item.info?.new_tasks)) {
          const chip = element('button', `chip ${option.on ? 'on' : 'suggest'}`, option.title);
          chip.type = 'button';
          chip.setAttribute('aria-pressed', String(option.on));
          chip.onclick = async () => {
            try { await call('/api/settings/triage-new-tasks', { method: 'POST', body: JSON.stringify({ value: option.value }) }); triageMode = option.value; notify(`Новые задачи: ${option.title}`); render(); }
            catch (error) { notify(error.message); }
          };
          chips.append(chip);
        }
        nodes.push(...section('Новые задачи', [chips]));
        const lines = aiStatsLines(item.info?.decisions);
        if (lines.length) nodes.push(...section('За 7 дней', lines.map((line) => element('p', 'system-detail', line))));
      }
      if (showsQr(item)) nodes.push(qrBlock(item));
      if (item.info?.chats !== undefined) nodes.push(element('p', 'system-detail', `Чатов ${item.info.chats}, групп ${item.info.groups}, отключено ${item.info.excluded}`));
      const failed = data.actions.filter((action) => action.connector === item.source && action.status === 'failed');
      if (failed.length) nodes.push(...section('Не отправлено', failed.map(actionRow)));
      return nodes;
    };
  }

  function cardOf(item, data) {
    return card(item, {
      open: opened.has(item.source),
      onToggle: (open) => { if (open) opened.add(item.source); else opened.delete(item.source); render(); },
      onSwitch: async (on, input) => {
        try { await call(`/api/connectors/${item.source}`, { method: 'POST', body: JSON.stringify({ on }) }); notify(`${item.title}: ${on ? 'включён' : 'выключен'}`); render(); }
        catch (error) { input.checked = !on; notify(error.message); }
      },
      body: cardBody(item, data),
    });
  }

  async function render() {
    try {
      const data = await call('/api/system');
      stopQr();
      const groups = systemGroups(data.sources);
      const nodes = [];
      // What needs attention: a short list on top; a tap opens that card in its group.
      if (groups.attention.length) {
        const banner = element('div', 'system-attention');
        banner.append(element('p', 'system-attention-title', `⚠ Требуют внимания: ${groups.attention.length}`),
          ...groups.attention.map((item) => button('system-attention-item', `${item.title} — ${item.detail ?? (item.failed_24h ? `не отправлено: ${item.failed_24h}` : '')}`.replace(/ — $/, ''), async () => {
            opened.add(item.source);
            await render();
            body.querySelector(`[data-card="${item.source}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          })));
        nodes.push(banner);
      } else nodes.push(element('p', 'system-all-ok', '✓ Всё подключённое работает'));
      const cards = (list) => list.map((item) => { const node = cardOf(item, data); node.dataset.card = item.source; return node; });
      nodes.push(...section('Каналы', cards(groups.channels)), ...section('Сервисы', cards(groups.services)));
      nodes.push(element('p', 'picker-section', 'Журнал'),
        fold(`Отправки наружу${data.actions.some((action) => action.status === 'failed') ? ` · не отправлено: ${data.actions.filter((action) => action.status === 'failed').length}` : ''}`, data.actions.map(actionRow), 'Ответов наружу ещё не было'),
        fold(`Неотслеживаемые чаты · ${data.exclusions.length}`, data.exclusions.map(exclusionRow), 'Все чаты отслеживаются'));
      body.replaceChildren(...nodes);
    } catch (error) {
      body.replaceChildren(element('p', 'system-empty', `${error.message}. Экран «Система» работает только в сети`));
    }
  }

  document.querySelector('#system-close').onclick = () => dialog.close();
  dialog.addEventListener('close', stopQr);
  document.querySelector('#system-refresh').onclick = render;
  return { open: () => { dialog.showModal(); render(); }, retry: retryAction };
}
