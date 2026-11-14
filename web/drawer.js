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

  function close() {
    if (drawer.hidden) return;
    drawer.hidden = true;
    backdrop.hidden = true;
    if (history.state?.drawer) history.back();
  }

  function open() {
    render();
    drawer.hidden = false;
    backdrop.hidden = false;
    history.pushState({ drawer: true }, '');
  }

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
  window.addEventListener('popstate', () => { if (!drawer.hidden && !history.state?.drawer) { drawer.hidden = true; backdrop.hidden = true; } });
  return { render: () => { if (!drawer.hidden) render(); }, close };
}
