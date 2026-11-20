// Swipe zones of the whole app (owner's rule, 2026-11-19): the screen width is split 25 / 50 / 25. A horizontal swipe
// that starts in an edge column, or in the middle but not on an object (a task row or plaque, a conversation row —
// whatever swipe.js decorates), moves between screens: the tabs of the surface on top, the left panel before the
// first tab, the right panel after the last. A swipe that starts on an object in the middle is the object's own
// (swipe.js). Touch events, not pointer ones: they keep coming while the browser scrolls. Pure parts tested in node.
import { reduced } from './motion.js';

export const EDGE = 0.25;
export const TRIGGER_PX = 60;
const START_PX = 12;

// Which column a point is in.
export function zoneOf(x, width) {
  if (x < width * EDGE) return 'left';
  if (x > width * (1 - EDGE)) return 'right';
  return 'middle';
}

// Does the object take the swipe (swipe.js), or is it the screen's?
export const objectTakes = (zone, onObject) => zone === 'middle' && onObject;

// What a screen swipe does. `dir`: 'prev' — the finger moves right (towards what is on the left), 'next' — left.
// surface 'main': the left panel and the right one at the ends of the tabs (and from their edges);
// surface 'details' (the right panel on a phone): its tabs; before the first one, or from the left edge — close.
// Returns { tab: i } | 'drawer' | 'right' | 'close' | null.
export function swipeAction({ surface, zone, dir, tab = 0, tabs = 0 }) {
  if (surface === 'details') {
    if (dir === 'prev') return zone === 'left' || tab <= 0 ? 'close' : { tab: tab - 1 };
    return tab < tabs - 1 ? { tab: tab + 1 } : null;
  }
  if (dir === 'prev') return zone === 'left' || tab <= 0 ? 'drawer' : { tab: tab - 1 };
  return zone === 'right' || tab >= tabs - 1 ? 'right' : { tab: tab + 1 };
}

// An element that scrolls sideways keeps its own swipes (chip rows, the participants' cloud, pages of a window).
function scrollsSideways(target, root) {
  for (let node = target; node && node !== root && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 2) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}

// A short slide of the new content in the swipe's direction.
export function slideIn(node, dir) {
  if (!node || reduced()) return;
  node.animate([{ transform: `translateX(${dir === 'next' ? 28 : -28}px)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'cubic-bezier(.2, 0, 0, 1)' });
}

// deps: { isWide(), drawer: { isOpen(), open(), drag: { begin(point), move(point), end(point) } },
//   details: { isOpen() (over the screen on a phone), panel, close() }, openRight() → bool (something was opened),
//   tabs: { index(), count(), go(i, dir) } (the main tabs: Беседы · Задачи), notify(text) }
export function setupSwipeZones(deps) {
  let start = null; // { x, y, zone, surface, horizontal, drawer }
  const blocked = (target) => document.body.classList.contains('selecting') || document.body.classList.contains('picking')
    || Boolean(document.querySelector('dialog[open], .task-sheet')) || Boolean(target.closest?.('input, textarea, select, [contenteditable="true"], .composer-area, #drawer, #task-screen'));

  // The tabs of the card in the right panel: buttons with role=tab inside [data-swipe-tabs].
  const cardTabs = () => {
    const bar = deps.details.panel?.querySelector('[data-swipe-tabs]');
    const buttons = bar ? [...bar.querySelectorAll('[role="tab"]')] : [];
    return { buttons, index: Math.max(0, buttons.findIndex((item) => item.getAttribute('aria-selected') === 'true')) };
  };

  document.addEventListener('touchstart', (event) => {
    start = null;
    if (event.touches.length !== 1 || deps.isWide() || deps.drawer.isOpen()) return;
    const target = event.target;
    if (blocked(target)) return;
    const touch = event.touches[0];
    const zone = zoneOf(touch.clientX, window.innerWidth);
    const surface = deps.details.isOpen() ? 'details' : 'main';
    if (surface === 'details' && !deps.details.panel.contains(target)) return;
    if (objectTakes(zone, Boolean(target.closest?.('[data-swipe-object]')))) return;
    if (scrollsSideways(target, surface === 'details' ? deps.details.panel : document.querySelector('#messages'))) return;
    start = { x: touch.clientX, y: touch.clientY, zone, surface, horizontal: null, drawer: false };
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!start) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (start.horizontal === null) {
      if (Math.abs(dx) < START_PX && Math.abs(dy) < START_PX) return;
      start.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
      if (!start.horizontal) { start = null; return; }
      // The left panel follows the finger when it is what this swipe opens.
      if (start.surface === 'main' && dx > 0 && swipeAction({ surface: 'main', zone: start.zone, dir: 'prev', tab: deps.tabs.index(), tabs: deps.tabs.count() }) === 'drawer') {
        start.drawer = true;
        deps.drawer.drag.begin({ clientX: start.x, clientY: start.y });
      }
    }
    if (start.drawer) deps.drawer.drag.move({ clientX: touch.clientX, clientY: touch.clientY });
  }, { passive: true });

  const finish = (event) => {
    if (!start?.horizontal) { start = null; return; }
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const gesture = start;
    start = null;
    if (gesture.drawer) { deps.drawer.drag.end({ clientX: touch.clientX }); return; }
    if (Math.abs(dx) < TRIGGER_PX) return;
    const dir = dx > 0 ? 'prev' : 'next';
    if (gesture.surface === 'details') {
      const { buttons, index } = cardTabs();
      const action = swipeAction({ surface: 'details', zone: gesture.zone, dir, tab: index, tabs: buttons.length });
      if (action === 'close') deps.details.close();
      else if (action?.tab !== undefined) buttons[action.tab].click();
      return;
    }
    const action = swipeAction({ surface: 'main', zone: gesture.zone, dir, tab: deps.tabs.index(), tabs: deps.tabs.count() });
    if (action === 'right') { if (!deps.openRight()) deps.notify?.('Справа пока пусто: откройте задачу или беседу'); }
    else if (action === 'drawer') deps.drawer.open();
    else if (action?.tab !== undefined) deps.tabs.go(action.tab, dir);
  };
  document.addEventListener('touchend', finish, { passive: true });
  document.addEventListener('touchcancel', () => { if (start?.drawer) deps.drawer.drag.end({ clientX: start.x }); start = null; }, { passive: true });
}
