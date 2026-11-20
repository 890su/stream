// Finds conversations for pinned shortcuts and search in the left panel.
export const favourites = (items) => items.filter((item) => item.pinned && item.item?.chat_id !== undefined)
  .map((item) => ({ key: `tg:${item.item.chat_id}`, title: item.title }));

export function searchConversations(conversations, query) {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  const number = /^[+\d ()-]+$/.test(text) ? text.replace(/\D/g, '') : '';
  return conversations.filter(({ key, title }) => key !== 'me' && !key.startsWith('task:')
    && (title.toLowerCase().includes(text) || (number && key.startsWith('tel:') && key.slice(4).includes(number))))
    .sort((a, b) => Date.parse(b.last) - Date.parse(a.last));
}
