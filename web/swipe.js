// A horizontal swipe on a list item (task rows and plaques, conversation rows): the item follows the finger, past
// SWIPE_PX it is armed (`data-swipe` = the side's name, class `armed` — the styles colour it), on release the side's
// action runs. Vertical moves scroll as usual; the click that ends a swipe does not open the item.
const SWIPE_PX = 80;

export function swipe(item, { onRight, onLeft, right = 'right', left = 'left', skip = () => false }) {
  let start = null; // { x, y, horizontal }
  let swiped = false;
  const reset = () => { item.style.transform = ''; delete item.dataset.swipe; item.classList.remove('swiping', 'armed'); start = null; };
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
    item.style.transform = `translateX(${Math.max(-140, Math.min(140, dx))}px)`;
    item.dataset.swipe = dx > 0 ? right : left;
    item.classList.toggle('armed', Math.abs(dx) >= SWIPE_PX);
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
