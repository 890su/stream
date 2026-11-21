// Keeping the reader's place across a redraw of the centre (feed.js): the row they read — the one across the middle of
// the screen, else the first one on it — is found again after the redraw and put back where it was. Queue tiles are
// rebuilt on every redraw, so they are found by their conversation (`data-conversation`) or `data-row`; message
// bubbles are kept nodes. Places are measured from the scroller's top, so a bar appearing or hiding above it (the
// conversation header) does not move the row.

const ROWS = '[data-conversation], [data-row], .bubble';
const offset = (scroller, node) => node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

// { node, key (a selector to find it again), offset } or null. `node` — pin this one; `rows` — which rows may be picked.
export function rowOnScreen(scroller, list, node = null, rows = ROWS) {
  const box = scroller.getBoundingClientRect();
  const middle = (box.top + box.bottom) / 2;
  const candidates = node ? [] : [...list.querySelectorAll(rows)];
  const pick = node ?? candidates.find((item) => { const r = item.getBoundingClientRect(); return r.top <= middle && r.bottom > middle; })
    ?? candidates.find((item) => item.getBoundingClientRect().bottom > box.top);
  if (!pick) return null;
  const key = pick.dataset.conversation ? `[data-conversation="${CSS.escape(pick.dataset.conversation)}"]`
    : pick.dataset.row ? `[data-row="${CSS.escape(pick.dataset.row)}"]` : null;
  return { node: pick, key, offset: offset(scroller, pick) };
}

// Scrolls so the pinned row is where it was; false when it is gone.
export function putBack(scroller, list, pin) {
  const node = pin.node.isConnected ? pin.node : pin.key ? list.querySelector(pin.key) : null;
  if (node) scroller.scrollTop += offset(scroller, node) - pin.offset;
  return Boolean(node);
}
