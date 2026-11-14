// The topic screen: only the messages of one topic, its name (tap to rename) and the composer writing into it.
// It takes the place of the feed; the Android back gesture returns to the feed (history entry).
export function setupTopicScreen({ feed, composer, onRename }) {
  const screen = document.querySelector('#topic-screen');
  const list = document.querySelector('#topic-list');
  let root = null;

  const chain = () => (root ? feed.chain(root) : undefined);
  const views = () => (chain()?.ids ?? []).map((id) => feed.view(id)).filter(Boolean);

  function render() {
    const current = chain();
    if (!current) { if (root) close(); return; }
    root = current.root; // the first message can change after a detach
    document.querySelector('#topic-name').textContent = current.title;
    document.querySelector('#topic-name').classList.toggle('named', current.named);
    const count = current.ids.length;
    document.querySelector('#topic-meta').textContent = `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'сообщение' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'сообщения' : 'сообщений'}`;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    list.replaceChildren(...views().map((view) => feed.bubble(view)));
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }

  function open(id) {
    const current = feed.chain(id);
    if (!current) return;
    if (!root) history.pushState({ topic: current.root }, '');
    root = current.root;
    document.body.classList.add('in-topic');
    screen.hidden = false;
    composer.enterTopic({ last: () => views().at(-1) });
    render();
    list.scrollTop = list.scrollHeight;
  }

  function close() {
    if (!root) return;
    root = null;
    screen.hidden = true;
    document.body.classList.remove('in-topic');
    composer.leaveTopic();
  }

  document.querySelector('#topic-back').onclick = () => history.back();
  window.addEventListener('popstate', () => close());
  const rename = () => { const current = chain(); if (current) onRename(current); };
  document.querySelector('#topic-name').onclick = rename;
  document.querySelector('#topic-rename').onclick = rename;
  return { open, render: () => { if (root) render(); }, isOpen: () => Boolean(root) };
}
