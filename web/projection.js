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
      edited: false, archived: false, deleted: false, history: [], pending: pendingIds.has(event.id), replyTo: null, replies: 0,
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
    if (parent && !view.deleted) parent.replies += 1;
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

// Every message connected to `id` through replies (until topics exist, this is "the related messages").
export function related(views, id) {
  const byId = new Map(views.map((view) => [view.id, view]));
  const rootOf = (view) => {
    const seen = new Set();
    while (view.event.reply_to && byId.has(view.event.reply_to) && !seen.has(view.id)) { seen.add(view.id); view = byId.get(view.event.reply_to); }
    return view.id;
  };
  const start = byId.get(id);
  if (!start) return [];
  const root = rootOf(start);
  return views.filter((view) => !view.deleted && rootOf(view) === root);
}

// Versions of one message, oldest (the source) first, the current one last.
export function versions(view) {
  const list = view.history.map((item, index) => ({ text: item.text, tags: item.tags, at: index === 0 ? view.event.ts : view.history[index - 1].ts }));
  list.push({ text: view.text, tags: view.tags, at: view.history.length ? view.history.at(-1).ts : view.event.ts });
  return list.map((item, index) => ({ ...item, label: index === 0 ? (list.length === 1 ? 'Без правок' : 'Исходное') : index === list.length - 1 ? 'Текущая' : `Редакция ${index}` }));
}

const dayOf = (ts) => new Date(ts).toDateString();

// Messages written one after another (pause up to `gapMinutes`, same day) are shown as one bubble.
// A reply starts a new bubble: its quote belongs at the top.
export function bursts(views, gapMinutes) {
  const groups = [];
  let previous;
  for (const view of views) {
    const gap = previous ? Date.parse(view.event.ts) - Date.parse(previous.event.ts) : Infinity;
    const joins = previous && gap >= 0 && gap <= gapMinutes * 60000 && dayOf(view.event.ts) === dayOf(previous.event.ts) && !view.replyTo;
    if (joins) groups.at(-1).push(view); else groups.push([view]);
    previous = view;
  }
  return groups;
}

// For every message in a reply chain of two or more: the chain, its title and the message's position in it.
export function chains(views) {
  const result = new Map();
  for (const view of views) {
    if (result.has(view.id) || view.deleted) continue;
    const chain = related(views, view.id);
    if (chain.length < 2) continue;
    chain.forEach((item, index) => result.set(item.id, { ids: chain.map((entry) => entry.id), index, title: snippet(chain[0]) }));
  }
  return result;
}
