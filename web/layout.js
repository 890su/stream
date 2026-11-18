// Wide screens show the filters and the details beside the centre instead of sliding over it (wide.css,
// CONCEPT.md §5). One place for the breakpoint the panels follow.
const query = matchMedia('(min-width: 1100px)');

export const isWide = () => query.matches;
export const onWideChange = (handler) => query.addEventListener('change', () => handler(query.matches));
