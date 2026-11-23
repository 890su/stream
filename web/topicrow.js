// The line of topics in a conversation card (topics design 2026-11-23): one tile per live topic or task of the
// conversation (topiclive.js) — the kind (☑ task, ◇ topic, ◇✨ the AI offers a task), the title, and × to take the
// topic out of this conversation or 📣 on the chosen one, which stands first and takes the next message. ▸ unfolds the
// line into a column; folded, it scrolls sideways. A tap on a title chooses it, a tap on the chosen title switches it
// off (no topic: the triage decides). The chosen tile's icon opens its menu (make a task, back to a topic, open the
// task, rename); under the line the AI's offer for the chosen topic with ✓ ✕ and why. «+ тема…» starts a new one.
// Pure helpers (rowOrder, tileOf, removeChanges, reasonOf) are tested in node; topicRow draws.
import { isTopic, hasOffer } from './topickind.js';

// Why the AI made it: the reason of its first change (the AI log), else its note.
export const reasonOf = (task) => task.history?.find((entry) => entry.change?.reason)?.change.reason ?? task.note ?? '';

// The chosen record first, the rest in their order.
export function rowOrder(live, chosenId) {
  const chosen = live.find((task) => task.id === chosenId);
  return chosen ? [chosen, ...live.filter((task) => task !== chosen)] : [...live];
}

// { icon, title, end } of a tile.
export function tileOf(task, chosen) {
  const icon = !isTopic(task) ? '☑' : task.offer ? '◇✨' : '◇';
  return { icon, title: task.title || 'Без названия', end: chosen ? '📣' : '×' };
}

// × on a tile: this conversation's messages leave the record; a topic left with none is closed, a task is not.
// → [{ id, change }].
export function removeChanges(task, conversation) {
  const here = new Set((conversation.views ?? []).map((view) => view.id));
  const remove = (task.messages ?? []).filter((id) => here.has(id));
  const left = (task.messages ?? []).filter((id) => !here.has(id));
  const closes = isTopic(task) && !left.length;
  return [{ id: task.id, change: { op: 'update', remove, ...(closes ? { status: 'cancelled', reason: 'Убрана из бесед' } : {}) } }];
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick, label) {
  const node = element('button', className, text);
  node.type = 'button';
  node.onclick = onClick;
  if (label) node.setAttribute('aria-label', label);
  return node;
}

// The chosen tile's menu, under its icon; closes on any other tap.
function openMenu(anchor, items) {
  document.querySelector('.topic-menu')?.remove();
  const menu = element('div', 'topic-menu');
  menu.setAttribute('role', 'menu');
  for (const item of items) menu.append(button('topic-menu-item', item.title, () => { menu.remove(); item.run(); }));
  const box = anchor.getBoundingClientRect();
  menu.style.top = `${Math.round(box.bottom + 4)}px`;
  menu.style.left = `${Math.max(8, Math.min(Math.round(box.left), window.innerWidth - 220))}px`;
  document.body.append(menu);
  const away = (event) => { if (!menu.contains(event.target)) { menu.remove(); document.removeEventListener('pointerdown', away, true); } };
  setTimeout(() => document.addEventListener('pointerdown', away, true));
}

// `live` — rowOrder'ed records; `chosen` — the chosen id or null; `expanded` — the column; `on`: { choose(id | null),
// remove(task), toTask(task), toTopic(task), open(task), rename(task, title), confirm(task), reject(task),
// create(title), expand(open) }.
export function topicRow({ live, chosen, expanded = false, on }) {
  const box = element('div', `topic-row${expanded ? ' open' : ''}`);
  const toggle = button('topic-row-toggle', expanded ? '▾' : '▸', () => on.expand(!expanded), expanded ? 'Свернуть темы' : 'Все темы беседы');
  toggle.setAttribute('aria-expanded', String(expanded));
  const tiles = element('div', 'topic-row-tiles');
  for (const task of rowOrder(live, chosen)) {
    const picked = task.id === chosen;
    const face = tileOf(task, picked);
    const tile = element('span', `topic-tile${picked ? ' selected' : ''}${isTopic(task) ? ' topic' : ' task'}`);
    const icon = button('topic-tile-icon', face.icon, () => {
      if (!picked) { on.choose(task.id); return; }
      openMenu(icon, [
        isTopic(task) ? { title: 'Сделать задачей', run: () => on.toTask(task) } : { title: 'Вернуть в тему', run: () => on.toTopic(task) },
        ...(isTopic(task) ? [] : [{ title: 'Открыть задачу', run: () => on.open(task) }]),
        { title: 'Переименовать', run: () => rename(tile, title, task) },
      ]);
    }, picked ? `${face.title}: меню` : `Выбрать тему «${face.title}»`);
    const title = button('topic-tile-title', face.title, () => on.choose(picked ? null : task.id),
      picked ? `«${face.title}» — следующие сообщения сюда; выключить` : `Писать в «${face.title}»`);
    title.setAttribute('aria-pressed', String(picked));
    tile.append(icon, title, picked ? element('span', 'topic-tile-speaker', face.end)
      : button('topic-tile-remove', face.end, () => on.remove(task), `Убрать «${face.title}» из беседы`));
    tiles.append(tile);
  }
  const input = element('input', 'topic-row-input');
  input.placeholder = '+ тема…';
  input.setAttribute('aria-label', 'Новая тема этой беседы: название');
  input.enterKeyHint = 'done';
  input.onkeydown = (event) => {
    if (event.key !== 'Enter' || !input.value.trim()) return;
    event.preventDefault();
    on.create(input.value.trim().slice(0, 120));
    input.value = '';
    input.blur();
  };
  tiles.append(input);
  box.append(toggle, tiles);
  const nodes = [box];
  const offered = live.find((task) => task.id === chosen && hasOffer(task));
  if (offered) {
    const offer = element('div', 'topic-offer');
    offer.append(element('span', 'topic-offer-text', 'ИИ: сделать задачей?'),
      button('chip suggest topic-offer-yes', '✓', () => on.confirm(offered), `Сделать «${offered.title}» задачей`),
      button('chip suggest muted topic-offer-no', '✕', () => on.reject(offered), `Оставить «${offered.title}» темой`));
    const reason = reasonOf(offered);
    if (reason) offer.append(element('span', 'topic-offer-reason', `Почему: ${reason}`));
    nodes.push(offer);
  }
  return nodes;

  // The title turns into a field: Enter saves, Escape or leaving it keeps the old one.
  function rename(tile, title, task) {
    const field = element('input', 'topic-tile-rename');
    field.value = task.title ?? '';
    field.setAttribute('aria-label', 'Новое название темы');
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const next = field.value.trim().slice(0, 120);
      if (save && next && next !== task.title) on.rename(task, next); else field.replaceWith(title);
    };
    field.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); finish(true); } else if (event.key === 'Escape') finish(false); };
    field.onblur = () => finish(false);
    title.replaceWith(field);
    field.focus();
    field.select();
  }
}
