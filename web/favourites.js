// «Избранные» in the left panel (CONCEPT.md §5, design 2026-11-20): the chats pinned with the star in the link
// window (recipients.js), each opening its conversation. Until conversations are per person (stage 3) these are
// Telegram chats. Pure.
export const favourites = (items) => items.filter((item) => item.pinned && item.item?.chat_id !== undefined)
  .map((item) => ({ key: `tg:${item.item.chat_id}`, title: item.title }));
