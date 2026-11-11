// Folds journal events into what the feed shows (CONCEPT.md §2.4). Pure: no DOM, no storage.
// Messages keep their original event; corrections change only the view, latest correction wins.

const order = (a, b) => (Date.parse(a.ts) - Date.parse(b.ts)) || (a.received_at ?? '￿').localeCompare(b.received_at ?? '￿');

export function project(events, pendingIds = new Set()) {
  const views = new Map();
  const corrections = [];
  for (const event of events) {
    if (event.kind === 'correction') { corrections.push(event); continue; }
    views.set(event.id, {
      id: event.id, event, text: event.payload?.text ?? '', tags: event.payload?.tags ?? [],
      edited: false, archived: false, deleted: false, history: [], pending: pendingIds.has(event.id), replyTo: null,
    });
  }
  for (const correction of corrections.sort(order)) {
    const view = views.get(correction.payload?.ref?.id);
    if (!view) continue; // its message is not loaded yet; it is applied once the message arrives
    if (pendingIds.has(correction.id)) view.pending = true;
    switch (correction.payload?.data?.op) {
      case 'edit':
        view.history.push({ text: view.text, tags: view.tags, ts: correction.ts });
        view.text = correction.payload.text ?? '';
        view.tags = correction.payload.tags ?? [];
        view.edited = true;
        break;
      case 'archive': view.archived = true; break;
      case 'unarchive': view.archived = false; break;
      case 'delete': view.deleted = true; break;
      case 'restore': view.deleted = false; break;
      default: break;
    }
  }
  for (const view of views.values()) {
    const parentId = view.event.reply_to;
    if (!parentId) continue;
    const parent = views.get(parentId);
    view.replyTo = !parent ? { id: parentId, missing: true } : parent.deleted ? { id: parentId, deleted: true } : { id: parentId, text: parent.text, event: parent.event };
  }
  return [...views.values()].sort((a, b) => order(a.event, b.event));
}

// One line for a quote or a reply bar.
export function snippet(view) {
  if (!view || view.missing) return 'Сообщение';
  if (view.deleted) return 'Удалённое сообщение';
  const text = (view.text ?? '').trim().replace(/\s+/g, ' ');
  if (text) return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  const kind = view.event?.kind;
  return kind === 'voice' ? 'Голосовое' : kind === 'photo' ? 'Фото' : kind === 'file' ? 'Файл' : 'Сообщение';
}
