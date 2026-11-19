// A horizontal swipe on a list item (task rows and plaques, conversation rows): the item follows the finger, past
// SWIPE_PX it is armed (`data-swipe` = the side's name, class `armed` — the styles colour it), on release the side's
// action runs. On the place the item leaves, the side's icon and label show (task card design §2): pale before the
// threshold, bright after it. Vertical moves scroll as usual; the click that ends a swipe does not open the item.
export const SWIPE_PX = 80;
const MAX_PX = 140;

// What the swipe reveals: { side, icon, text, armed } or null (no move, or no action on that side). Pure.
export function revealOf(dx, labels = {}) {
  if (!dx) return null;
  const side = dx > 0 ? 'right' : 'left';
  const label = labels[side];
  if (!label) return null;
  return { side, icon: label.icon, text: label.text, armed: Math.abs(dx) >= SWIPE_PX };
}

// `labels` — { right: { icon, text }, left: { icon, text } } for the revealed strip.
export function swipe(item, { onRight, onLeft, right = 'right', left = 'left', skip = () => false, labels = {} }) {
  let start = null; // { x, y, horizontal }
  let swiped = false;
  let under = null; // the revealed strip, inside the item but outside its box
  const clearUnder = () => { under?.remove(); under = null; };
  const reset = () => { item.style.transform = ''; delete item.dataset.swipe; item.classList.remove('swiping', 'armed'); clearUnder(); start = null; };
  const showUnder = (dx) => {
    const reveal = revealOf(dx, labels);
    if (!reveal) { clearUnder(); return; }
    if (!under) {
      under = document.createElement('span');
      under.setAttribute('aria-hidden', 'true');
      under.append(document.createElement('span'), document.createElement('span'));
      under.firstChild.className = 'swipe-icon';
      under.lastChild.className = 'swipe-text';
      item.append(under);
    }
    under.className = `swipe-under ${reveal.side}${reveal.armed ? ' armed' : ''}`;
    under.firstChild.textContent = reveal.icon;
    under.lastChild.textContent = reveal.text;
    // The strip covers exactly the place the item left: to its left when it moves right, and back.
    const width = Math.abs(dx);
    under.style.width = `${width}px`;
    under.style.left = reveal.side === 'right' ? `${-width}px` : '';
    under.style.right = reveal.side === 'left' ? `${-width}px` : '';
  };
  item.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || skip(event)) return;
    start = { x: event.clientX, y: event.clientY, horizontal: null };
  });
  item.addEventListener('pointermove', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.horizontal === null) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      start.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
      if (!start.horizontal) { reset(); return; }
      item.classList.add('swiping');
    }
    const shift = Math.max(-MAX_PX, Math.min(MAX_PX, dx));
    item.style.transform = `translateX(${shift}px)`;
    item.dataset.swipe = dx > 0 ? right : left;
    item.classList.toggle('armed', Math.abs(dx) >= SWIPE_PX);
    showUnder(shift);
  });
  item.addEventListener('pointerup', (event) => {
    if (!start?.horizontal) { reset(); return; }
    const dx = event.clientX - start.x;
    reset();
    swiped = true;
    setTimeout(() => { swiped = false; }, 400);
    if (dx >= SWIPE_PX) onRight?.(); else if (dx <= -SWIPE_PX) onLeft?.();
  });
  item.addEventListener('pointercancel', reset);
  // A swipe is not a tap: the click after it does not open the item.
  item.addEventListener('click', (event) => { if (swiped) { event.stopPropagation(); event.preventDefault(); } }, true);
}
