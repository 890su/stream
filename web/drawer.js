// Left panel: active topics (days since the last message, archive) and tags that filter the feed.
// The left half of a topic goes to its first message, the right half to its newest one.
const ARCHIVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/><path d="M5 9v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/></svg>';
const RESTORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/><path d="M5 9v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V9M12 17v-5M9.5 14.5 12 12l2.5 2.5"/></svg>';
const DAY = 86400000;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function age(ts) {
  const days = Math.floor((Date.now() - Date.parse(ts)) / DAY);
  return days <= 0 ? 'сегодня' : `${days} дн.`;
}

export function setupDrawer({ feed, onJump, onArchiveTopic, onFilterChange }) {
  const drawer = document.querySelector('#drawer');
  const backdrop = document.querySelector('#drawer-backdrop');
  const topicsBox = document.querySelector('#drawer-topics');
  const tagsBox = document.querySelector('#drawer-tags');

  // The drawer sits between the top bar and the composer; both stay visible and usable.
  function place() {
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const bottom = window.innerHeight - document.querySelector('.composer-area').getBoundingClientRect().top;
    document.documentElement.style.setProperty('--drawer-top', `${Math.max(0, top)}px`);
    document.documentElement.style.setProperty('--drawer-bottom', `${Math.max(0, bottom)}px`);
  }
  const isOpen = () => drawer.classList.contains('open');

  function show(on) {
    drawer.classList.remove('dragging'); backdrop.classList.remove('dragging');
    drawer.style.transform = ''; backdrop.style.opacity = '';
    if (on) {
      place(); render();
      drawer.hidden = false; backdrop.hidden = false;
      void drawer.offsetWidth; // apply the closed position first, so the opening slides in
      drawer.classList.add('open');
      if (!history.state?.drawer) history.pushState({ drawer: true }, '');
    } else {
      drawer.classList.remove('open');
      backdrop.hidden = true;
      setTimeout(() => { if (!isOpen()) drawer.hidden = true; }, 230);
    }
  }

  function close() {
    if (!isOpen()) return;
    show(false);
    if (history.state?.drawer) history.back();
  }

  function open() { show(true); }

  // Swipe left to right on the feed opens the drawer; right to left on the drawer or backdrop closes it.
  // The panel follows the finger; letting go past a third of its width finishes the move.
  const START_PX = 12;
  let drag = null; // { x, y, opening, width, horizontal }
  function begin(event, opening) {
    if (event.pointerType === 'mouse' || document.body.classList.contains('selecting') || document.body.classList.contains('picking')) return;
    drag = { x: event.clientX, y: event.clientY, opening, width: drawer.offsetWidth || 300, horizontal: null };
  }
  function move(event) {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.horizontal === null) {
      if (Math.abs(dx) < START_PX && Math.abs(dy) < START_PX) return;
      drag.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5 && (drag.opening ? dx > 0 : dx < 0);
      if (!drag.horizontal) { drag = null; return; }
      if (drag.opening) { place(); render(); drawer.hidden = false; backdrop.hidden = false; }
      drawer.classList.add('dragging'); backdrop.classList.add('dragging');
    }
    const offset = drag.opening ? Math.min(0, dx - drag.width) : Math.min(0, dx);
    drawer.style.transform = `translateX(${offset}px)`;
    backdrop.style.opacity = String(1 + offset / drag.width);
  }
  function end(event) {
    if (!drag) return;
    const moved = drag.horizontal ? event.clientX - drag.x : 0;
    const { opening, width, horizontal } = drag;
    drag = null;
    if (!horizontal) return;
    const far = Math.abs(moved) > width / 3;
    if (opening) show(far);
    else if (far) close(); else show(true);
  }
  const feedArea = document.querySelector('#messages');
  feedArea.addEventListener('pointerdown', (event) => { if (!isOpen()) begin(event, true); });
  for (const surface of [drawer, backdrop]) surface.addEventListener('pointerdown', (event) => { if (isOpen()) begin(event, false); });
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', () => { if (drag?.horizontal) show(drag.opening ? false : true); drag = null; });
  window.addEventListener('resize', () => { if (!drawer.hidden) place(); });

  function topicRow(topic) {
    const row = element('div', `drawer-topic${topic.archived ? ' archived' : ''}`);
    const first = element('button', 'drawer-half first');
    first.type = 'button';
    first.append(element('span', `drawer-title${topic.named ? ' named' : ''}`, topic.title), element('span', 'drawer-sub', `${topic.ids.length} в теме`));
    first.setAttribute('aria-label', `${topic.title}: к первому сообщению`);
    first.onclick = () => { close(); onJump(topic.first.id); };
    const last = element('button', 'drawer-half last');
    last.type = 'button';
    last.append(element('span', 'drawer-age', age(topic.last.event.ts)), element('span', 'drawer-go', '›'));
    last.setAttribute('aria-label', `${topic.title}: к последнему сообщению`);
    last.onclick = () => { close(); onJump(topic.last.id); };
    const archive = element('button', 'icon-button drawer-archive');
    archive.type = 'button';
    archive.innerHTML = topic.archived ? RESTORE : ARCHIVE;
    archive.setAttribute('aria-label', topic.archived ? `Вернуть тему «${topic.title}» из архива` : `Тему «${topic.title}» в архив`);
    archive.onclick = () => onArchiveTopic(topic);
    row.append(first, last, archive);
    return row;
  }

  function render() {
    const topics = feed.topics().filter((topic) => feed.showArchive() || !topic.archived);
    topicsBox.replaceChildren(...(topics.length ? topics.map(topicRow) : [element('p', 'drawer-empty', 'Тем пока нет. Свяжите сообщения — появится тема.')]));
    const counts = new Map();
    for (const view of feed.views()) if (!view.deleted) for (const tag of view.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const active = new Set(feed.tagFilter());
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
    tagsBox.replaceChildren(...(tags.length ? tags.map(([tag, count]) => {
      const chip = element('button', `chip ${active.has(tag) ? 'on' : 'suggest'}`, `${tag} ${count}`);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(active.has(tag)));
      chip.onclick = async () => {
        if (active.has(tag)) active.delete(tag); else active.add(tag);
        await feed.setTagFilter([...active]);
        onFilterChange();
        render();
      };
      return chip;
    }) : [element('p', 'drawer-empty', 'Меток пока нет')]));
  }

  document.querySelector('#drawer-button').onclick = open;
  document.querySelector('#drawer-close').onclick = close;
  backdrop.onclick = close;
  window.addEventListener('popstate', () => { if (isOpen() && !history.state?.drawer) show(false); });
  return { render: () => { if (!drawer.hidden) render(); }, close };
}
