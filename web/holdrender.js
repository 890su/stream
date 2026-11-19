// Redraws that wait while the owner is busy in a panel (2026-11-19): a live update rebuilds the left panel, the
// details or the centre, which would throw away a half-typed name or an open list of choices. While an input or a
// list of choices inside `box` is in use, `run()` is held and done once, when the owner leaves it.
// The checklist's item field is left out: it keeps focus to add items one after another and wants every redraw.
const BUSY = 'input:focus:not(.checklist-add input), textarea:focus, [data-holding]';

export function holdRender(box, render) {
  let held = false;
  const busy = () => Boolean(box.querySelector(BUSY));
  const release = () => {
    // Focus moves after focusout; check on the next turn.
    setTimeout(() => { if (held && !busy()) { held = false; render(); } }, 0);
  };
  box.addEventListener('focusout', release);
  box.addEventListener('click', release);
  return function run(...args) {
    if (busy()) { held = true; return undefined; }
    held = false;
    return render(...args);
  };
}

// Marks a list of choices as in use (`on`) so redraws wait; cleared when the choice is made or closed.
export function holding(node, on = true) {
  if (on) node.dataset.holding = ''; else delete node.dataset.holding;
}
