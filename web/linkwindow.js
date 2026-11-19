// The link window (CONCEPT.md §2.9, 2026-11-19), opened by the round «связь» button: sections Метки · Контакты ·
// Беседы · Задачи. Most likely first; the rest by a swipe left (tags in a strip, long items in pages). A tap on a
// section title expands it to the whole window with «назад», a search and the full list. Choosing a tag switches it
// for the next message; a contact becomes the recipient; a conversation or a task is what the message goes into.
import { normalizeTag } from './suggest.js';
import { STATE_LABELS, tasksLabel } from './convlist.js';
import { dueLabel } from './tasklist.js';
import { isOpen } from './taskfold.js';
import { snippet } from './projection.js';

const PAGE = 3; // rows per page
const PAGES = 5; // pages in a section of the overview
const TAGS = 40; // tags in the overview strip
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/></svg>';
const TITLES = { tags: 'Метки', contacts: 'Контакты', conversations: 'Беседы', tasks: 'Задачи' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Conversations most likely first: the open one, then «срочно» and «ждёт меня», then the latest. Pure.
export function likelyConversations(list, openKey = null) {
  const rank = (item) => (item.key === openKey ? 0 : item.state === 'urgent' || item.state === 'mine' ? 1 : 2);
  return list.filter((item) => item.key !== 'me').sort((a, b) => rank(a) - rank(b) || b.last.localeCompare(a.last));
}

// Open tasks most likely first: the one in details, those of the open conversation, «Сегодня», the latest changed. Pure.
export function likelyTasks(tasks, { openTask = null, conversationTasks = [], today = [] } = {}) {
  const inConversation = new Set(conversationTasks.map((task) => task.id));
  const forToday = new Set(today.map((task) => task.id));
  const rank = (task) => (task.id === openTask ? 0 : inConversation.has(task.id) ? 1 : forToday.has(task.id) ? 2 : 3);
  return tasks.filter((task) => isOpen(task) && !task.filed).sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

// `tagRow`, `recipients` — the composer's; `context()` → { conversations, tasks, openConversation, openTask,
// conversationTasks, today }; `attached()` / `attach(link | null)` — the conversation or task the message goes into.
export function setupLinkWindow({ tagRow, recipients, context, attached, attach, notify, close }) {
  const panel = document.querySelector('#link-panel');
  const head = document.querySelector('#link-head');
  const title = document.querySelector('#link-title');
  const body = document.querySelector('#link-body');
  let expanded = null; // a section shown on the whole window
  let query = '';
  const scroll = new Map(); // section -> scrollLeft of its strip, kept across redraws

  // Items of a list section: { key, title, sub, on, pick() }.
  function items(id) {
    const ctx = context();
    const link = attached();
    if (id === 'contacts') return recipients.items(query).map((item) => ({ ...item, pick: () => { recipients.choose(item.on ? null : item.item); close(); } }));
    const match = (text) => !query || text.toLowerCase().includes(query.toLowerCase());
    if (id === 'conversations') {
      return likelyConversations(ctx.conversations, ctx.openConversation).filter((item) => match(item.title)).map((item) => {
        const on = link?.type === 'conversation' && link.key === item.key;
        const last = item.views.filter((view) => !view.deleted).at(-1);
        const open = item.tasks.filter((task) => isOpen(task) && !task.filed).length;
        return { key: item.key, title: item.title, sub: [STATE_LABELS[item.state], open ? tasksLabel(open) : '', last ? snippet(last) : ''].filter(Boolean).join(' · '), on,
          pick: () => { attach(on ? null : { type: 'conversation', key: item.key, title: item.title }); close(); } };
      });
    }
    return likelyTasks(ctx.tasks, ctx).filter((task) => match(task.title)).map((task) => {
      const on = link?.type === 'task' && link.id === task.id;
      return { key: task.id, title: task.title, sub: dueLabel(task)?.text ?? '', on, pick: () => { attach(on ? null : { type: 'task', id: task.id, title: task.title }); close(); } };
    });
  }

  function row(item, { pin = false } = {}) {
    const line = element('div', `link-row${item.on ? ' on' : ''}`);
    const pick = element('button', 'link-pick');
    pick.type = 'button';
    pick.setAttribute('aria-pressed', String(item.on));
    pick.append(element('span', 'link-label', item.title));
    if (item.sub) pick.append(element('small', 'link-sub', item.sub));
    pick.onclick = item.pick;
    line.append(pick);
    if (pin) {
      const star = element('button', `icon-button link-pin${item.pinned ? ' active' : ''}`);
      star.type = 'button'; star.innerHTML = STAR; star.disabled = !item.anchor;
      star.setAttribute('aria-label', !item.anchor ? 'Закрепить можно после первого сообщения в чате' : item.pinned ? 'Открепить' : 'Закрепить первым');
      star.onclick = () => recipients.togglePin(item.item);
      line.append(star);
    }
    return line;
  }

  const empty = (id) => element('p', 'link-empty', { tags: 'Меток пока нет: наберите #слово', contacts: 'Пока некому писать: адресаты — чаты Telegram и группы с ботом', conversations: 'Бесед пока нет', tasks: 'Открытых задач нет' }[id]);

  // A strip that keeps its horizontal position when the window redraws.
  function strip(id, className, children) {
    const box = element('div', className);
    box.append(...children);
    box.addEventListener('scroll', () => scroll.set(id, box.scrollLeft), { passive: true });
    requestAnimationFrame(() => { box.scrollLeft = scroll.get(id) ?? 0; });
    return box;
  }

  function section(id) {
    const box = element('section', 'link-section');
    const header = element('button', 'link-section-title');
    header.type = 'button';
    const list = id === 'tags' ? tagRow.ordered() : items(id);
    header.append(element('span', '', TITLES[id]), element('span', 'link-count', String(list.length)));
    header.onclick = () => { expanded = id; query = ''; render(); };
    box.append(header);
    if (!list.length) { box.append(empty(id)); return box; }
    if (id === 'tags') {
      box.append(strip(id, 'link-tags', list.slice(0, TAGS).map(({ tag, state }) => tagRow.chip(tag, state))));
      return box;
    }
    const pages = [];
    for (let start = 0; start < Math.min(list.length, PAGE * PAGES); start += PAGE) {
      const page = element('div', 'link-page');
      page.append(...list.slice(start, start + PAGE).map((item) => row(item)));
      pages.push(page);
    }
    box.append(strip(id, 'link-pages', pages));
    return box;
  }

  function full(id) {
    const search = Object.assign(element('input', 'link-search'), { type: 'search', value: query, placeholder: id === 'tags' ? 'Найти метку' : 'Найти', autocomplete: 'off' });
    search.setAttribute('aria-label', `Найти: ${TITLES[id]}`);
    search.oninput = () => { query = search.value; renderList(); };
    const listBox = element('div', id === 'tags' ? 'link-tags-all chips' : 'link-list');
    function renderList() {
      if (id === 'tags') {
        const found = tagRow.ordered().filter(({ tag }) => !query || tag.includes(query.toLowerCase().replace(/^#?/, '')));
        listBox.replaceChildren(...found.map(({ tag, state }) => tagRow.chip(tag, state)));
        if (!found.length) listBox.append(empty(id));
        return;
      }
      const found = items(id);
      listBox.replaceChildren(...(found.length ? found.map((item) => row(item, { pin: id === 'contacts' })) : [empty(id)]));
    }
    renderList();
    const parts = [search, listBox];
    if (id === 'tags') parts.push(newTagForm());
    return parts;
  }

  function newTagForm() {
    const form = element('form', 'new-tag');
    form.autocomplete = 'off';
    const input = Object.assign(element('input'), { type: 'text', placeholder: '#новая-метка', maxLength: 40, enterKeyHint: 'done' });
    input.setAttribute('aria-label', 'Новая метка');
    const add = element('button', 'link-button', 'Добавить');
    add.type = 'submit';
    form.append(input, add);
    form.onsubmit = (event) => {
      event.preventDefault();
      if (tagRow.addNew(normalizeTag(input.value.trim().startsWith('#') ? input.value.trim() : `#${input.value.trim()}`))) input.value = '';
      else notify('Метка — одно слово: буквы, цифры, «-» или «_»');
    };
    return form;
  }

  function render() {
    if (panel.hidden) return;
    head.hidden = !expanded;
    if (expanded) {
      title.textContent = TITLES[expanded];
      // Keep the search field (and the keyboard) while typing: only a fresh expansion rebuilds the body.
      if (body.dataset.section !== expanded) { body.dataset.section = expanded; body.replaceChildren(...full(expanded)); }
      return;
    }
    body.dataset.section = '';
    body.replaceChildren(...['tags', 'contacts', 'conversations', 'tasks'].map(section));
  }

  document.querySelector('#link-back').onclick = () => { expanded = null; query = ''; render(); };

  return {
    // Opened by the composer (togglePanel); always starts at the overview.
    reset: () => { expanded = null; query = ''; body.dataset.section = ''; },
    render,
    // Something changed (a tag, a pin, a recipient, a live event): redraw, except while the search is being typed in.
    refresh: () => {
      if (panel.hidden || document.activeElement?.classList.contains('link-search')) return;
      body.dataset.section = '';
      render();
    },
  };
}
