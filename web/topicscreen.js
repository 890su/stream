// The topic screen: only the messages of one topic or one case (CONCEPT.md §2.9), its name and the composer
// writing into it. A topic's name renames it; a case's name opens its task card. It takes the place of the
// feed; the Android back gesture returns to the feed (history entry).
import { STATUSES } from './taskfold.js';
import { reveal, conceal } from './motion.js';

const plural = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'сообщение' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'сообщения' : 'сообщений');

export function setupTopicScreen({ feed, composer, onRename, onTaskCard, caseCard = () => null }) {
  const screen = document.querySelector('#topic-screen');
  const list = document.querySelector('#topic-list');
  let current = null; // { kind: 'topic', root } | { kind: 'case', task }

  const chain = () => (current?.kind === 'topic' ? feed.chain(current.root) : undefined);
  const views = () => (current?.kind === 'case' ? feed.caseViews(current.task)
    : (chain()?.ids ?? []).map((id) => feed.view(id)).filter(Boolean));

  // { title, named, meta } of what is open, or null when it is gone.
  function heading() {
    if (current?.kind === 'case') {
      const task = feed.task(current.task);
      if (!task) return null;
      const count = views().length;
      return { title: task.title, named: true, meta: `дело · ${STATUSES[task.status] ?? task.status} · ${count} ${plural(count)}` };
    }
    const topic = chain();
    if (!topic) return null;
    current.root = topic.root; // the first message can change after a detach
    return { title: topic.title, named: topic.named, meta: `${topic.ids.length} ${plural(topic.ids.length)}` };
  }

  function render() {
    const head = heading();
    if (!head) { if (current) close(); return; }
    document.querySelector('#topic-name').textContent = head.title;
    document.querySelector('#topic-name').classList.toggle('named', head.named);
    document.querySelector('#topic-meta').textContent = head.meta;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    const card = current.kind === 'case' && caseCard(feed.task(current.task));
    list.replaceChildren(...views().map((view) => feed.bubble(view)), ...(card ? [card] : []));
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }

  function show(next) {
    if (!current) history.pushState({ topic: true }, '');
    current = next;
    document.body.classList.add('in-topic');
    reveal(screen, 'translateX(32px)');
    screen.setAttribute('aria-label', next.kind === 'case' ? 'Дело' : 'Тема');
    composer.enterTopic({ last: () => views().at(-1) }, next.kind === 'case' ? 'Сообщение в дело' : 'Сообщение в тему');
    render();
    list.scrollTop = list.scrollHeight;
  }

  function open(id) {
    const topic = feed.chain(id);
    if (topic) show({ kind: 'topic', root: topic.root });
  }

  function openCase(taskId) {
    if (feed.task(taskId)) show({ kind: 'case', task: taskId });
  }

  function close() {
    if (!current) return;
    current = null;
    conceal(screen, 'translateX(32px)');
    document.body.classList.remove('in-topic');
    composer.leaveTopic();
    feed.render(); // the completion card moves back to the feed
  }

  document.querySelector('#topic-back').onclick = () => history.back();
  // Back from a panel opened on this screen (the task card) keeps the screen.
  window.addEventListener('popstate', () => { if (!history.state?.topic) close(); });
  const rename = () => {
    if (current?.kind === 'case') { onTaskCard(current.task); return; }
    const topic = chain();
    if (topic) onRename(topic);
  };
  document.querySelector('#topic-name').onclick = rename;
  document.querySelector('#topic-rename').onclick = rename;
  return { open, openCase, render: () => { if (current) render(); }, isOpen: () => Boolean(current) };
}
