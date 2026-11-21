// The «Архив» above the queue of «Беседы» (owner, 2026-11-21): a folded divider right above the newest waiting
// conversation. Open, the last handled conversations (queue.js archiveList) stand right above it — the latest nearest —
// earlier ones higher, five at a time; «Загрузить ещё» on top, or going on up past the top, adds five more (from older
// history when the loaded part runs out). Opening and folding keep the divider in place (scrollpin.js); opened, the
// rows slide into view while the divider stays on screen.
import { rowOnScreen } from './scrollpin.js';
import { reduced } from './motion.js';

const PAGE = 5;
const NEAR_TOP = 160;

function element(tag, className, text, row) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  if (row) node.dataset.row = row;
  if (tag === 'button') node.type = 'button';
  return node;
}

// `render(options)` — the centre's redraw (feed.js); `active()` — the queue is on screen; `hasOlder`, `loadOlder` —
// the journal's pages (feedpage.js).
export function createArchive({ scroller, list, render, active, hasOlder, loadOlder }) {
  let open = false;
  let shown = PAGE;
  let total = 0;
  let calmUntil = 0; // our own scrolling does not count as the reader asking for more
  let growing = false;

  // The nodes above the queue: [«Загрузить ещё»], the shown rows (earliest on top), the divider. `archived` — the
  // archive list, the last handled first; `tile(item)` builds a row.
  function nodes(archived, tile) {
    total = archived.length;
    const children = [];
    if (open) {
      if (total > shown || hasOlder()) {
        const more = element('button', 'link-button archive-more', 'Загрузить ещё', 'archive-more');
        more.onclick = () => void grow(more);
        children.push(more);
      }
      children.push(...archived.slice(0, shown).reverse().map(tile));
      if (!total && !hasOlder()) children.push(element('p', 'archive-empty', 'Разобранных бесед пока нет', 'archive-empty'));
    }
    const divider = element('button', `archive-divider${open ? ' open' : ''}`, undefined, 'archive');
    divider.setAttribute('aria-expanded', String(open));
    divider.append(element('span', 'archive-label', `🗄 Архив${open ? '' : ' — разобранные беседы'}`), element('span', 'archive-arrow', open ? '▾' : '▴'));
    divider.onclick = () => { open = !open; shown = PAGE; void render({ quiet: true, pin: rowOnScreen(scroller, list, divider), reveal: open }); };
    children.push(divider);
    return children;
  }

  // Right after opening: down as far as the block's top needs, but the divider stays on screen.
  function reveal() {
    const divider = list.querySelector('[data-row="archive"]');
    const first = list.querySelector('[data-row="archive-more"], .conv-tile.archived, [data-row="archive-empty"]');
    if (!divider || !first) return;
    const box = scroller.getBoundingClientRect();
    const down = Math.min(box.top + 8 - first.getBoundingClientRect().top, box.bottom - 8 - divider.getBoundingClientRect().bottom);
    if (down <= 0) return;
    calmUntil = Date.now() + 800;
    scroller.scrollBy({ top: -down, behavior: reduced() ? 'auto' : 'smooth' });
  }

  // Five more above: from what is loaded, else from older history (a few pages, until there is more to show). A tap
  // on «Загрузить ещё» (`button`) keeps it in place: the five appear under it. Going on up keeps the row being read in
  // place instead: the five appear above, out of view, and the scroll goes on into them — no jump.
  async function grow(button = null) {
    if (growing || !open || !active()) return;
    growing = true;
    try {
      for (let pages = 0; total <= shown && hasOlder() && pages < 5; pages += 1) await loadOlder();
      if (total <= shown) return;
      shown += PAGE;
      await render({ quiet: true, pin: button ? rowOnScreen(scroller, list, button) : rowOnScreen(scroller, list, null, '.conv-tile, [data-row="archive"]') });
    } finally { growing = false; }
  }

  // Going on up: scrolling up near the top, a wheel or a pull at the very top.
  let lastTop = scroller.scrollTop;
  scroller.addEventListener('scroll', () => {
    const upward = scroller.scrollTop < lastTop;
    lastTop = scroller.scrollTop;
    if (open && active() && upward && scroller.scrollTop < NEAR_TOP && Date.now() > calmUntil) void grow();
  }, { passive: true });
  scroller.addEventListener('wheel', (event) => { if (event.deltaY < 0 && scroller.scrollTop <= 0 && open && active()) void grow(); }, { passive: true });
  let pullFrom = null;
  scroller.addEventListener('touchstart', (event) => { pullFrom = scroller.scrollTop <= 0 ? event.touches[0].clientY : null; }, { passive: true });
  scroller.addEventListener('touchmove', (event) => {
    if (pullFrom !== null && event.touches[0].clientY - pullFrom > 48 && open && active()) { pullFrom = null; void grow(); }
  }, { passive: true });

  return { nodes, reveal };
}
