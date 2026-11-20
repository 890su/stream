// The view switch at the right end of the input row (CONCEPT.md §5, 2026-11-19; an icon since 2026-11-20): ☑ Задачи
// on Беседы, 💬 Беседы on Задачи and Лента, with a counter of the open context; the top bar names the current view.
// The queue of Беседы is the root: the system back from Задачи or Лента leads there (rootBack). counterFor, switchIcon
// and rootBack are pure.
import { isOpen } from './taskfold.js';

const TITLES = { conversations: 'Беседы', tasks: 'Задачи', feed: 'Лента' };
const ICONS = { conversations: '💬', tasks: '☑' };
export const switchIcon = (target) => ICONS[target] ?? '';

// Where the system back goes when it lands on `state` in view `mode`: the queue, unless that entry is the view's own
// (a panel or a conversation above it was closed) or the queue is already shown. null — nothing to do here.
export function rootBack(mode, state) {
  if (mode === 'conversations') return null;
  if (state?.view === mode || state?.drawer || state?.details || state?.conversation) return null;
  return 'conversations';
}

// Going back to the queue from a view with its own history entry: pop that entry ('back'), so no dead entry is left
// for the system back to step through at the root; else switch in place ('stay').
export const toQueue = (state) => (state?.view ? 'back' : 'stay');
const waiting = (conversation) => Boolean(conversation.queue?.waiting); // in the queue (queue.js)

// What the switch leads to and its number: { target: 'tasks' | 'conversations', count, open (conversation key) }.
export function counterFor({ mode, conversationKey = null, taskId = null, conversations = [], todayCount = 0 }) {
  if (mode === 'conversations') {
    if (!conversationKey) return { target: 'tasks', count: todayCount, open: null };
    const conversation = conversations.find((item) => item.key === conversationKey);
    const count = (conversation?.tasks ?? []).filter((task) => isOpen(task) && !task.filed).length;
    return { target: 'tasks', count, open: conversationKey };
  }
  if (taskId) {
    const linked = conversations.filter((item) => item.tasks.some((task) => task.id === taskId));
    const mine = linked.filter(waiting);
    return { target: 'conversations', count: mine.length, open: mine[0]?.key ?? linked[0]?.key ?? null };
  }
  if (conversationKey) {
    const conversation = conversations.find((item) => item.key === conversationKey);
    return { target: 'conversations', count: conversation && waiting(conversation) ? 1 : 0, open: conversationKey };
  }
  return { target: 'conversations', count: conversations.filter(waiting).length, open: null };
}

// `feed` — feed.js; `todayCount()` — tasks of «Сегодня»; `taskId()` — the task open in details, or null;
// `go(mode, key)` — switch the view (and open a conversation when key is set).
export function setupViewSwitch({ feed, todayCount, taskId, go }) {
  const button = document.querySelector('#view-switch');
  const label = document.querySelector('#view-switch-label');
  const badge = document.querySelector('#view-switch-count');
  const title = document.querySelector('#view-title');
  let state = { target: 'tasks', count: 0, open: null };

  function update() {
    const mode = feed.mode();
    title.textContent = TITLES[mode] ?? '';
    state = counterFor({ mode, conversationKey: feed.conversationKey(), taskId: taskId(), conversations: feed.conversations(), todayCount: todayCount() });
    label.textContent = switchIcon(state.target);
    badge.textContent = state.count ? String(state.count) : '';
    badge.hidden = !state.count;
    const what = state.target === 'tasks' ? 'задач' : 'бесед ждут ответа';
    button.setAttribute('aria-label', `${TITLES[state.target]}${state.count ? `: ${state.count} ${what}` : ''}`);
  }

  button.onclick = () => go(state.target, state.open);
  return { update };
}
