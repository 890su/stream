// The views of the centre and the system back (docs/plans/2026-11-21-workspace-redesign-design.md): the dashboard
// (home) is the root — the app opens on it and the system back ends there; a list of Задачи and the Лента get a
// history entry of their own, an open conversation one of its own (chatview.js). The view switch by the input is
// gone: the left panel opens conversations, contacts and lists. The top bar names the view. backTarget and toHome
// are pure.

const TITLES = { home: 'Сейчас', conversations: 'Беседа', tasks: 'Задачи', feed: 'Лента' };

// Where the system back goes when it lands on `state` in view `mode`: the view under it (a conversation opened over
// a list), else the dashboard; null — nothing to do here (an entry of a panel, a card or the view itself, or home).
export function backTarget(mode, state) {
  if (state?.drawer || state?.details || state?.conversation || state?.task) return null;
  const target = state?.view ?? 'home';
  return target === mode ? null : target;
}

// Going home from a view or a conversation with its own history entry: pop that entry ('back'), so no dead entry is
// left for the system back to step through at the root; else switch in place ('stay').
export const toHome = (state) => (state?.view || state?.conversation ? 'back' : 'stay');

// The view's name in the top bar.
export function setupViewTitle({ feed }) {
  const title = document.querySelector('#view-title');
  return { update() { title.textContent = TITLES[feed.mode()] ?? ''; } };
}
