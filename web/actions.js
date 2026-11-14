// Message actions: long press (touch), "more" button or right click (mouse), menu key (keyboard).
const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 10;
const GAP_PX = 8;

export function setupActions({ list, getView, onAction }) {
  const layer = document.querySelector('#action-layer');
  const panel = document.querySelector('#action-panel');
  const archiveButton = panel.querySelector('[data-op="archive"]');
  let selected; // the bubble the panel belongs to
  let gesture; // { x, y, timer } of a possible long press
  let suppressClick = false;

  function place(bubble) {
    const box = bubble.getBoundingClientRect();
    const height = panel.offsetHeight;
    const width = panel.offsetWidth;
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom + GAP_PX;
    const bottom = document.querySelector('.composer-area').getBoundingClientRect().top - GAP_PX;
    let y = box.top - height - GAP_PX;
    if (y < top) y = Math.min(box.bottom + GAP_PX, bottom - height);
    const x = Math.min(Math.max(GAP_PX, box.right - width), window.innerWidth - width - GAP_PX);
    panel.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(top, y))}px)`;
  }

  function open(bubble) {
    const view = getView(bubble.dataset.id);
    if (!view) return;
    close();
    selected = bubble;
    const archived = view.archived;
    archiveButton.querySelector('span').textContent = archived ? 'Вернуть' : 'В архив';
    archiveButton.setAttribute('aria-label', archived ? 'Вернуть из архива' : 'В архив');
    const linkButton = panel.querySelector('[data-op="link"]');
    linkButton.querySelector('span').textContent = view.continues ? 'Отделить' : 'Связать';
    linkButton.setAttribute('aria-label', view.continues ? 'Отделить от предыдущего' : 'Связать с предыдущим сообщением');
    layer.hidden = false;
    panel.hidden = false;
    place(bubble);
    bubble.classList.add('selected');
    panel.querySelector('button').focus({ preventScroll: true });
    navigator.vibrate?.(10);
  }

  function close() {
    if (layer.hidden) return;
    layer.hidden = true;
    panel.hidden = true;
    selected?.classList.remove('selected');
    selected?.focus({ preventScroll: true });
    selected = undefined;
  }

  const bubbleOf = (target) => target.closest('.bubble');
  const isControl = (target) => target.closest('button, a, audio, input');

  // After a long press or swipe the browser may or may not send a click, and the panel is now under the finger.
  // Swallow clicks while the finger is down and for a moment after it lifts, in the feed and on the backdrop.
  let fingerDown = false;
  const swallowNextClick = () => { suppressClick = true; if (!fingerDown) setTimeout(() => { suppressClick = false; }, 350); };
  const lift = () => { fingerDown = false; if (suppressClick) setTimeout(() => { suppressClick = false; }, 350); };
  window.addEventListener('pointerup', lift, true);
  window.addEventListener('pointercancel', lift, true);

  list.addEventListener('pointerdown', (event) => {
    suppressClick = false;
    fingerDown = event.pointerType !== 'mouse';
    const bubble = bubbleOf(event.target);
    if (!bubble || event.pointerType === 'mouse' || isControl(event.target)) return;
    gesture = { x: event.clientX, y: event.clientY,
      timer: setTimeout(() => { swallowNextClick(); gesture = undefined; open(bubble); }, LONG_PRESS_MS) };
  });
  // Moving the finger means scrolling, not a long press.
  list.addEventListener('pointermove', (event) => {
    if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > MOVE_CANCEL_PX) { clearTimeout(gesture.timer); gesture = undefined; }
  });
  const end = () => { if (gesture) { clearTimeout(gesture.timer); gesture = undefined; } };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  list.addEventListener('click', (event) => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); return; }
    if (event.target.closest('[data-actions]')) { event.stopPropagation(); open(bubbleOf(event.target)); }
    const proceed = event.target.closest('[data-continue]');
    if (proceed) { event.stopPropagation(); const view = getView(bubbleOf(proceed).dataset.id); if (view) onAction('continue', view); return; }
    const history = event.target.closest('[data-history]');
    if (history) { event.stopPropagation(); const view = getView(bubbleOf(history).dataset.id); if (view) onAction('history', view); }
  }, true);
  list.addEventListener('contextmenu', (event) => {
    const bubble = bubbleOf(event.target);
    if (!bubble) return;
    event.preventDefault();
    if (!selected) open(bubble);
  });
  list.addEventListener('keydown', (event) => {
    const bubble = event.target.classList?.contains('bubble') ? event.target : null;
    if (bubble && (event.key === 'ContextMenu' || event.key === 'Enter' || (event.shiftKey && event.key === 'F10'))) {
      event.preventDefault();
      open(bubble);
    }
  });

  layer.addEventListener('click', (event) => { if (event.target === layer && !suppressClick) close(); });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const buttons = [...panel.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
    }
  });
  for (const button of panel.querySelectorAll('[data-op]')) {
    button.addEventListener('click', () => {
      const view = selected && getView(selected.dataset.id);
      close();
      if (view) onAction(button.dataset.op, view);
    });
  }
  window.addEventListener('resize', close);
  document.querySelector('#messages').addEventListener('scroll', close, { passive: true });
  return { close };
}
