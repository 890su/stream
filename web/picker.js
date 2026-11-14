import { snippet } from './projection.js';

const RECENT = 15;
const TOPICS = 8;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Choosing what to connect a message to: search, open topics, recent messages, or "choose in the feed"
// (scroll freely and tap; a banner shows the mode, Back cancels). One picker for the composer and the panel.
export function setupPicker({ getVisible, getChain, notify }) {
  const dialog = document.querySelector('#picker');
  const search = document.querySelector('#picker-search');
  const topicsBox = document.querySelector('#picker-topics');
  const messagesBox = document.querySelector('#picker-messages');
  const banner = document.querySelector('#pick-banner');
  let request = null; // { exclude, onPick }

  function row(label, sub, onClick, icon) {
    const button = element('button', 'picker-row');
    button.type = 'button';
    if (icon) button.append(element('span', `picker-icon ${icon}`));
    const text = element('span', 'picker-text');
    text.append(element('span', 'picker-label', label));
    if (sub) text.append(element('span', 'picker-sub', sub));
    button.append(text);
    button.onclick = onClick;
    return button;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const visible = getVisible().filter((view) => view.id !== request?.exclude);
    const matches = (value) => !query || value.toLowerCase().includes(query);
    const topics = new Map();
    for (const view of visible) {
      const chain = getChain(view.id);
      if (chain && !topics.has(chain.root)) topics.set(chain.root, chain);
    }
    const topicRows = [...topics.values()]
      .map((chain) => ({ chain, last: visible.filter((view) => chain.ids.includes(view.id)).at(-1) }))
      .filter((item) => item.last && matches(item.chain.title))
      .sort((a, b) => Date.parse(b.last.event.ts) - Date.parse(a.last.event.ts))
      .slice(0, TOPICS)
      .map(({ chain, last }) => row(chain.title, `${chain.ids.length} в теме`, () => pick(last), 'topic'));
    const messageRows = visible.filter((view) => matches(view.text || snippet(view))).slice(-RECENT).reverse()
      .map((view) => row(snippet(view), new Date(view.event.ts).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), () => pick(view)));
    topicsBox.replaceChildren(...(topicRows.length ? topicRows : [element('p', 'picker-empty', 'Открытых тем нет')]));
    messagesBox.replaceChildren(...(messageRows.length ? messageRows : [element('p', 'picker-empty', 'Ничего не найдено')]));
  }

  function pick(view) {
    const current = request;
    finish();
    current?.onPick(view);
  }

  function finish() {
    if (dialog.open) dialog.close();
    if (document.body.classList.contains('picking')) {
      document.body.classList.remove('picking');
      banner.hidden = true;
      if (history.state?.picking) history.back();
    }
    request = null;
  }

  function chooseInFeed() {
    dialog.close();
    document.body.classList.add('picking');
    banner.hidden = false;
    history.pushState({ picking: true }, '');
    notify('Прокрутите ленту и коснитесь нужного сообщения');
  }

  search.addEventListener('input', render);
  document.querySelector('#picker-feed').onclick = chooseInFeed;
  document.querySelector('#picker-close').onclick = () => finish();
  document.querySelector('#pick-cancel').onclick = () => finish();
  dialog.addEventListener('close', () => { if (!document.body.classList.contains('picking')) request = null; });
  window.addEventListener('popstate', () => {
    if (document.body.classList.contains('picking')) { document.body.classList.remove('picking'); banner.hidden = true; request = null; }
  });

  return {
    open(next) { request = next; search.value = ''; render(); dialog.showModal(); },
    // A tap on a message while choosing in the feed (actions.js).
    take(view) { if (request && view.id !== request.exclude) pick(view); },
    active: () => Boolean(request),
  };
}
