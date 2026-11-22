// A horizontal swipe on a list item (task rows and plaques, conversation rows): the item follows the finger, past
// SWIPE_PX it is armed (`data-swipe` = the side's name, class `armed` — the styles colour it), on release the side's
// action runs. On the place the item leaves, the side's icon and label show (task card design §2): pale before the
// threshold, bright after it. Vertical moves scroll as usual; the click that ends a swipe does not open the item.
// The item swipes only when grabbed in the middle half of the screen: the edges move between screens (swipezones.js).
// With a mouse (`peek`, owner 2026-11-22): the pointer near the item's right edge slides it a little and shows the
// left-swipe action, near the left edge the right-swipe one; a click on the shown action slides the item fully and
// runs it.
import { zoneOf } from './swipezones.js';

export const SWIPE_PX = 80;
const MAX_PX = 140;
export const PEEK_EDGE = 48; // how near an edge the mouse shows that side's action
const PEEK_PX = 44; // how far the item slides for it

// Which action a mouse at `x` over an item spanning [left, right] shows: near the right edge the left-swipe one, near
// the left edge the right-swipe one; null in the middle or with no action there. Pure.
export function peekSide(x, left, right, labels = {}, edge = PEEK_EDGE) {
  if (x >= right - edge && labels.left) return 'left';
  if (x <= left + edge && labels.right) return 'right';
  return null;
}

// What the swipe reveals: { side, icon, text, armed } or null (no move, or no action on that side). Pure.
export function revealOf(dx, labels = {}) {
  if (!dx) return null;
  const side = dx > 0 ? 'right' : 'left';
  const label = labels[side];
  if (!label) return null;
  return { side, icon: label.icon, text: label.text, armed: Math.abs(dx) >= SWIPE_PX };
}

// `labels` — { right: { icon, text }, left: { icon, text } } for the revealed strip.
export function swipe(item, { onRight, onLeft, right = 'right', left = 'left', skip = () => false, labels = {}, peek = false }) {
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
  item.dataset.swipeObject = '';
  item.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || skip(event) || zoneOf(event.clientX, window.innerWidth) !== 'middle') return;
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

  // The mouse at an edge: the action peeks out; a click on it runs it.
  let peeked = null; // 'left' | 'right'
  const unpeek = () => { if (!peeked) return; peeked = null; item.classList.remove('peeking'); item.style.transform = ''; clearUnder(); };
  let running = false;
  const runPeeked = (side) => {
    running = true;
    swiped = true; // the click that follows the press is not a tap on the item
    setTimeout(() => { swiped = false; }, 600);
    item.style.transform = `translateX(${side === 'left' ? -MAX_PX : MAX_PX}px)`;
    setTimeout(() => { running = false; unpeek(); if (side === 'left') onLeft?.(); else onRight?.(); }, 160);
  };
  if (peek) {
    item.addEventListener('pointermove', (event) => {
      if (running || event.pointerType !== 'mouse' || event.buttons || skip(event)) return;
      const box = item.getBoundingClientRect();
      const shift = peeked === 'left' ? -PEEK_PX : peeked === 'right' ? PEEK_PX : 0; // the box moved with the item
      const side = peekSide(event.clientX, box.left - shift, box.right - shift, labels);
      if (side === peeked) return;
      unpeek();
      if (!side) return;
      peeked = side;
      const dx = side === 'left' ? -PEEK_PX : PEEK_PX;
      item.classList.add('peeking');
      item.style.transform = `translateX(${dx}px)`;
      showUnder(dx);
      under.classList.add('peek');
      under.removeAttribute('aria-hidden');
      under.setAttribute('role', 'button');
      under.setAttribute('aria-label', labels[side].text);
      // On the press: the browser may report the pointer leaving the item before the click arrives.
      under.onpointerdown = (press) => { if (press.button !== 0) return; press.stopPropagation(); press.preventDefault(); runPeeked(side); };
      under.onkeydown = (key) => { if (key.key === 'Enter' || key.key === ' ') { key.preventDefault(); runPeeked(side); } };
    });
    item.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse' && !running) unpeek(); });
  }
  // A swipe is not a tap: the click after it does not open the item.
  item.addEventListener('click', (event) => { if (swiped) { event.stopPropagation(); event.preventDefault(); } }, true);
}
