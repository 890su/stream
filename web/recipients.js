// Recipients of the next message (CONCEPT.md §2.9): the address book (chats and groups with the bot, pinned and
// frequent first), the chosen recipient (its chip in the input row) and the rows of the link window's Контакты
// section (linkwindow.js). No recipient — a note to myself; nothing goes out by accident.
import { getSetting } from './db.js';
import { makeCorrection } from './shared.js';
import { accountTitle } from './tgbubble.js';
import { replyWindowClosed } from './outbound.js';

const CACHE = 'stream.recipients';
const GROUP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M15.5 5.8a3 3 0 0 1 0 5.4M17.5 14.2A5.5 5.5 0 0 1 20.5 19"/></svg>';

const short = (account) => accountTitle(account).replace(/^Telegram\s*/, '');
const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE) ?? '[]'); } catch { return []; } };
const writeCache = (list) => { try { localStorage.setItem(CACHE, JSON.stringify(list)); } catch { /* private mode: the list is fetched again */ } };

export function createRecipients({ getViews, notify, queue, onChange }) {
  let list = readCache();
  let chosen = null; // { key, account, chat_id, title, group }
  let enabled = true;

  async function load() {
    try {
      const response = await fetch('/api/recipients', { headers: { Authorization: `Bearer ${await getSetting('ownerToken')}` } });
      if (!response.ok) return;
      list = (await response.json()).recipients;
      writeCache(list);
      onChange?.(chosen);
    } catch { /* offline: the cached list stays */ }
  }

  // A personal chat answers only within 24 hours of the client's message; the server's answer or a newer
  // message already in the feed opens it.
  const isOpen = (item) => item.group || item.window_open || !replyWindowClosed(item, getViews());
  const facts = (item) => [accountTitle(item.account), item.group ? 'группа, пишет бот' : null, isOpen(item) ? null : 'окно 24 часа закрыто'].filter(Boolean).join(' · ');

  // The chosen recipient's chip in the input row: a tap takes it back.
  function chip() {
    if (!chosen || !enabled) return null;
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `chip recipient on${isOpen(chosen) ? '' : ' closed'}`;
    node.setAttribute('aria-label', `Кому: ${chosen.title}, ${accountTitle(chosen.account)}${isOpen(chosen) ? '' : ', окно 24 часа закрыто'}. Убрать`);
    if (chosen.group) node.innerHTML = GROUP;
    node.append(chosen.title);
    const badge = document.createElement('small');
    badge.textContent = short(chosen.account);
    node.append(badge);
    node.onclick = () => choose(null);
    return node;
  }

  // Items for the link window: pinned first, then frequent (the server's order), filtered by a query.
  const items = (query = '') => list.filter((item) => !query || item.title.toLowerCase().includes(query.toLowerCase()))
    .map((item) => ({ key: item.key, title: item.title, sub: facts(item), on: item.key === chosen?.key, item, group: item.group, pinned: item.pinned, anchor: item.anchor }));

  async function togglePin(item) {
    const op = item.pinned ? 'unpin' : 'pin';
    try { await queue(makeCorrection(item.anchor, op)); } catch (error) { notify(error.message); return; }
    item.pinned = !item.pinned;
    list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.count - a.count);
    writeCache(list); onChange?.(chosen);
  }

  function choose(item) {
    chosen = item ? (list.find((entry) => entry.key === item.key) ?? { ...item, window_open: false }) : null;
    onChange?.(chosen);
  }

  return {
    choose, load, chip, items, togglePin, isOpen,
    selected: () => (enabled ? chosen : null),
    // Back to no recipient after sending, or a conversation's default recipient.
    reset: (item = null) => choose(item),
    enable: (on) => { enabled = on; onChange?.(chosen); },
  };
}
