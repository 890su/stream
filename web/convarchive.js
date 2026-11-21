// The «Архив» under the queue of «Беседы» (owner, 2026-11-21; the queue reads top-down): a folded divider right under
// the newest waiting conversation. Open, the last handled conversations (queue.js archiveList) stand right under it —
// the latest nearest — earlier ones lower, five at a time; «Загрузить ещё» at the end, or going on down past the end,
// adds five more (from older history when the loaded part runs out). Opening and folding keep the divider in place
// (scrollpin.js); opened, the rows slide into view while the divider stays on screen.
import { rowOnScreen } from './scrollpin.js';
import { reduced } from './motion.js';

const PAGE = 5;
const NEAR_END = 160;

function element(tag, className, text, row) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  if (row) node.dataset.row = row;
  if (tag === 'button') node.type = 'button';
  return node;
}

// `render(options)` — the queue's redraw (queuepanel.js); `active()` — the queue is on screen; `hasOlder`, `loadOlder` —
// the journal's pages (feedpage.js).
export function createArchive({ scroller, list, render, active, hasOlder, loadOlder }) {
  let open = false;
  let shown = PAGE;
  let total = 0;
  let calmUntil = 0; // our own scrolling does not count as the reader asking for more
  let growing = false;

  // The nodes under the queue: the divider, the shown rows (the last handled first), [«Загрузить ещё»]. `archived` —
  // the archive list, the last handled first; `tile(item)` builds a row.
  function nodes(archived, tile) {
    total = archived.length;
    const divider = element('button', `archive-divider${open ? ' open' : ''}`, undefined, 'archive');
    divider.setAttribute('aria-expanded', String(open));
    divider.append(element('span', 'archive-label', `🗄 Архив${open ? '' : ' — разобранные беседы'}`), element('span', 'archive-arrow', open ? '▴' : '▾'));
    divider.onclick = () => { open = !open; shown = PAGE; void render({ quiet: true, pin: rowOnScreen(scroller, list, divider), reveal: open }); };
    const children = [divider];
    if (open) {
      children.push(...archived.slice(0, shown).map(tile));
      if (!total && !hasOlder()) children.push(element('p', 'archive-empty', 'Разобранных бесед пока нет', 'archive-empty'));
      if (total > shown || hasOlder()) {
        const more = element('button', 'link-button archive-more', 'Загрузить ещё', 'archive-more');
        more.onclick = () => void grow();
        children.push(more);
      }
    }
    return children;
  }

  // Right after opening: up as far as the block's end needs, but the divider stays on screen.
  function reveal() {
    const divider = list.querySelector('[data-row="archive"]');
    const last = [...list.querySelectorAll('[data-row="archive-more"], .conv-tile.archived, [data-row="archive-empty"]')].at(-1);
    if (!divider || !last) return;
    const box = scroller.getBoundingClientRect();
    const up = Math.min(last.getBoundingClientRect().bottom - (box.bottom - 8), divider.getBoundingClientRect().top - (box.top + 8));
    if (up <= 0) return;
    calmUntil = Date.now() + 800;
    scroller.scrollBy({ top: up, behavior: reduced() ? 'auto' : 'smooth' });
  }

  // Five more below: from what is loaded, else from older history (a few pages, until there is more to show). The
  // row being read stays in place: the five appear under it and the scroll goes on into them — no jump.
  async function grow() {
    if (growing || !open || !active()) return;
    growing = true;
    try {
      for (let pages = 0; total <= shown && hasOlder() && pages < 5; pages += 1) await loadOlder();
      if (total <= shown) return;
      shown += PAGE;
      await render({ quiet: true, pin: rowOnScreen(scroller, list, null, '.conv-tile, [data-row="archive"]') });
    } finally { growing = false; }
  }

  // Going on down: scrolling down near the end, a wheel or a pull at the very end.
  const toEnd = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  let lastTop = scroller.scrollTop;
  scroller.addEventListener('scroll', () => {
    const downward = scroller.scrollTop > lastTop;
    lastTop = scroller.scrollTop;
    if (open && active() && downward && toEnd() < NEAR_END && Date.now() > calmUntil) void grow();
  }, { passive: true });
  scroller.addEventListener('wheel', (event) => { if (event.deltaY > 0 && toEnd() <= 1 && open && active()) void grow(); }, { passive: true });
  let pullFrom = null;
  scroller.addEventListener('touchstart', (event) => { pullFrom = toEnd() <= 1 ? event.touches[0].clientY : null; }, { passive: true });
  scroller.addEventListener('touchmove', (event) => {
    if (pullFrom !== null && pullFrom - event.touches[0].clientY > 48 && open && active()) { pullFrom = null; void grow(); }
  }, { passive: true });

  return { nodes, reveal };
}
