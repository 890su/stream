// Wide screens show the filters and the details beside the centre instead of sliding over it (wide.css,
// CONCEPT.md §5). One place for the breakpoint the panels follow.
const query = globalThis.matchMedia?.('(min-width: 1100px)') ?? null; // none in node tests

export const isWide = () => Boolean(query?.matches);
export const onWideChange = (handler) => query?.addEventListener('change', () => handler(query.matches));
