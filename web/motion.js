// Smooth showing and hiding (owner's rule, 2026-11-18): nothing in the interface appears, disappears or folds
// with a jump. Height animations for feed rows, fades for panels. Respects «reduce motion».

export const DURATION = 200;
const EASE = 'cubic-bezier(.2, 0, 0, 1)';
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// An animation's end, or its planned end: a page in the background does not advance animations, and what the
// animation leads to (hiding, folding) must happen anyway.
const settled = (animation, ms) => Promise.race([animation.finished.catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms + 80))]);

// Plays an entrance and makes sure it ends: a frozen animation must not leave the element at its first frame.
export function play(element, keyframes, duration = DURATION) {
  if (reduced()) return Promise.resolve();
  const animation = element.animate(keyframes, { duration, easing: EASE });
  return settled(animation, duration).then(() => animation.cancel());
}

function frames(node, open) {
  const style = getComputedStyle(node);
  const full = { height: `${node.offsetHeight}px`, opacity: 1, marginTop: style.marginTop, marginBottom: style.marginBottom, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom };
  const none = { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' };
  return open ? [none, full] : [full, none];
}

// Rows grow from nothing to their height (and fade in).
export function grow(nodes) {
  if (reduced()) return;
  for (const node of nodes) {
    if (!node.isConnected) continue;
    node.style.overflow = 'hidden';
    play(node, frames(node, true)).then(() => { node.style.overflow = ''; });
  }
}

// Rows shrink to nothing, then `done` runs (it usually redraws without them).
export function shrink(nodes, done) {
  const live = nodes.filter((node) => node.isConnected);
  if (reduced() || !live.length) { done(); return; }
  for (const node of live) node.style.overflow = 'hidden';
  Promise.all(live.map((node) => settled(node.animate(frames(node, false), { duration: DURATION, easing: EASE, fill: 'forwards' }), DURATION)))
    .then(() => { done(); for (const node of live) { node.style.overflow = ''; for (const animation of node.getAnimations()) animation.cancel(); } });
}

// Shows an element that was `hidden`, fading and sliding it in.
export function reveal(element, from = 'translateY(8px)') {
  if (element.dataset.concealing) { for (const animation of element.getAnimations()) animation.cancel(); return; }
  if (!element.hidden) return;
  element.hidden = false;
  play(element, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }]);
}

// Hides an element smoothly; showing it again meanwhile cancels the hiding.
export function conceal(element, to = 'translateY(8px)') {
  if (element.hidden || element.dataset.concealing) return;
  if (reduced()) { element.hidden = true; return; }
  element.dataset.concealing = '1';
  const animation = element.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: to }], { duration: DURATION * 0.75, easing: EASE });
  let cancelled = false;
  animation.addEventListener('cancel', () => { cancelled = true; });
  settled(animation, DURATION * 0.75).then(() => {
    delete element.dataset.concealing;
    if (cancelled) return; // shown again meanwhile
    element.hidden = true;
    animation.cancel();
  });
}

// Sets `hidden` smoothly either way.
export const toggleHidden = (element, hide, offset) => (hide ? conceal(element, offset) : reveal(element, offset));
