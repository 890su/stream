// The «кому» side of the row above the input (CONCEPT.md §2.9): the address book (chats and groups with the
// bot, pinned and frequent first), the chosen recipient, the full list with search and pins.
// No recipient — a note to myself; nothing goes out by accident.
import { getSetting } from './db.js';
import { makeCorrection } from './shared.js';
import { accountTitle } from './tgbubble.js';
import { replyWindowClosed } from './outbound.js';

const $ = (selector) => document.querySelector(selector);
const CACHE = 'stream.recipients';
const GROUP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M15.5 5.8a3 3 0 0 1 0 5.4M17.5 14.2A5.5 5.5 0 0 1 20.5 19"/></svg>';
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/></svg>';

const short = (account) => accountTitle(account).replace(/^Telegram\s*/, '');
const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE) ?? '[]'); } catch { return []; } };
const writeCache = (list) => { try { localStorage.setItem(CACHE, JSON.stringify(list)); } catch { /* private mode: the list is fetched again */ } };

export function createRecipients({ config, getViews, notify, queue, onChange }) {
  const chips = $('#to-chips');
  const tagChips = $('#tag-chips');
  const button = $('#to-button');
  const panel = $('#to-panel');
  const search = $('#to-search');
  const listBox = $('#to-list');
  const rowSize = config.telegram?.address_book?.row_size ?? 8;
  let list = readCache();
  let chosen = null; // { key, account, chat_id, title, group }
  let shown = false; // the row shows recipients instead of tags
  let enabled = true;

  async function load() {
    try {
      const response = await fetch('/api/recipients', { headers: { Authorization: `Bearer ${await getSetting('ownerToken')}` } });
      if (!response.ok) return;
      list = (await response.json()).recipients;
      writeCache(list);
      render();
    } catch { /* offline: the cached list stays */ }
  }

  // A personal chat answers only within 24 hours of the client's message; the server's answer or a newer
  // message already in the feed opens it.
  const isOpen = (item) => item.group || item.window_open || !replyWindowClosed(item, getViews());

  function chip(item, on) {
    const chipButton = document.createElement('button');
    chipButton.type = 'button';
    chipButton.className = `chip recipient ${on ? 'on' : 'suggest'}${isOpen(item) ? '' : ' closed'}`;
    chipButton.setAttribute('aria-pressed', String(on));
    chipButton.setAttribute('aria-label', `${item.title}, ${accountTitle(item.account)}${item.group ? ', группа' : ''}${isOpen(item) ? '' : ', окно 24 часа закрыто'}`);
    if (item.group) chipButton.innerHTML = GROUP;
    chipButton.append(item.title);
    const badge = document.createElement('small');
    badge.textContent = short(item.account);
    chipButton.append(badge);
    chipButton.onclick = () => (on ? choose(null) : choose(item));
    return chipButton;
  }

  function render() {
    button.hidden = !enabled;
    button.classList.toggle('active', Boolean(chosen));
    button.setAttribute('aria-expanded', String(shown));
    chips.hidden = !shown || !enabled;
    tagChips.hidden = shown && enabled;
    if (!shown || !enabled) { chips.replaceChildren(); return; }
    const others = list.filter((item) => item.key !== chosen?.key).slice(0, rowSize);
    const all = document.createElement('button');
    all.type = 'button'; all.className = 'chip suggest'; all.textContent = 'Все…';
    all.onclick = () => openPanel();
    chips.replaceChildren(...(chosen ? [chip(chosen, true)] : []), ...others.map((item) => chip(item, false)), all);
  }

  function renderPanel() {
    const query = search.value.trim().toLowerCase();
    const found = list.filter((item) => !query || item.title.toLowerCase().includes(query));
    listBox.replaceChildren(...found.map((item) => {
      const line = document.createElement('div');
      line.className = `to-line${item.key === chosen?.key ? ' chosen' : ''}`;
      const pick = document.createElement('button');
      pick.type = 'button'; pick.className = 'to-pick';
      const name = document.createElement('span'); name.textContent = item.title;
      const facts = document.createElement('small');
      facts.textContent = [accountTitle(item.account), item.group ? 'группа, пишет бот' : null, isOpen(item) ? null : 'окно 24 часа закрыто'].filter(Boolean).join(' · ');
      pick.append(name, facts);
      pick.onclick = () => { choose(item); panel.hidden = true; };
      const pin = document.createElement('button');
      pin.type = 'button'; pin.className = `icon-button to-pin${item.pinned ? ' active' : ''}`; pin.innerHTML = STAR;
      pin.disabled = !item.anchor;
      pin.setAttribute('aria-label', !item.anchor ? 'Закрепить можно после первого сообщения в чате' : item.pinned ? 'Открепить' : 'Закрепить в строке «кому»');
      pin.onclick = () => togglePin(item);
      line.append(pick, pin);
      return line;
    }));
    if (!found.length) listBox.append(Object.assign(document.createElement('p'), { className: 'panel-title', textContent: list.length ? 'Никого не найдено' : 'Пока некому писать: адресаты — чаты Telegram и группы с ботом' }));
  }

  async function togglePin(item) {
    const op = item.pinned ? 'unpin' : 'pin';
    try { await queue(makeCorrection(item.anchor, op)); } catch (error) { notify(error.message); return; }
    item.pinned = !item.pinned;
    list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.count - a.count);
    writeCache(list); renderPanel(); render();
  }

  function openPanel() {
    search.value = '';
    renderPanel();
    panel.hidden = false;
    load().then(() => { if (!panel.hidden) renderPanel(); });
  }

  // Choosing a recipient shows the recipients in the row; the tags wait under #.
  function choose(item) {
    chosen = item ? (list.find((entry) => entry.key === item.key) ?? { ...item, window_open: false }) : null;
    if (chosen) shown = true;
    render(); onChange?.(chosen);
  }

  button.onclick = () => {
    shown = !shown;
    panel.hidden = true;
    render();
    if (shown) load();
  };
  search.addEventListener('input', renderPanel);

  return {
    choose, load, render,
    selected: () => chosen,
    isOpen,
    // Back to the tags: after sending, or a chat view's default recipient.
    reset: (item = null) => { chosen = null; shown = false; panel.hidden = true; if (item) choose(item); else { render(); onChange?.(null); } },
    enable: (on) => { enabled = on; if (!on) panel.hidden = true; render(); },
    closePanel: () => { panel.hidden = true; },
  };
}
