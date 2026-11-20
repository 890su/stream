// «Избранные» in the left panel (CONCEPT.md §5, design 2026-11-20): the chats pinned with the star in the link
// window (recipients.js), each opening its conversation. Until conversations are per person (stage 3) these are
// Telegram chats. And «Недавние» — the way back to conversations out of the queue. Pure.
export const favourites = (items) => items.filter((item) => item.pinned && item.item?.chat_id !== undefined)
  .map((item) => ({ key: `tg:${item.item.chat_id}`, title: item.title }));

// «Недавние» under them: every conversation with someone (not own notes), the latest message first — answered,
// archived and snoozed ones too, the way back to a conversation that left the queue. Pure.
export const recent = (conversations, limit = 30) => conversations
  .filter((item) => item.key !== 'me' && !item.key.startsWith('task:'))
  .sort((a, b) => Date.parse(b.last) - Date.parse(a.last)).slice(0, limit);
