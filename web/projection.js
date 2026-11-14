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
      // The message this one continues (CONCEPT.md §2.5): the owner's choice at capture, changed later by link/unlink.
      continues: event.payload?.data?.continuation?.on ? event.payload.data.continuation.target : null,
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
      case 'link': view.continues = correction.payload.data.target; break;
      case 'unlink': view.continues = null; break;
      case 'topic': view.topicTitle = correction.payload.data.title.trim(); break;
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

// Every message connected to `id` through replies and continuations (until topics exist, the "related" ones).
export function related(views, id) {
  const byId = new Map(views.map((view) => [view.id, view]));
  const parentOf = (view) => [view.event.reply_to, view.continues].find((target) => target && byId.has(target) && target !== view.id);
  const rootOf = (view) => {
    const seen = new Set();
    let parent;
    while ((parent = parentOf(view)) && !seen.has(view.id)) { seen.add(view.id); view = byId.get(parent); }
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

// One bubble = a message and the messages that continue it right after it. Time alone never joins messages:
// several unrelated things are often written within a minute (decisions.md, 2026-11-14).
export function bursts(views) {
  const groups = [];
  let previous;
  for (const view of views) {
    if (previous && view.continues === previous.id && !view.replyTo) groups.at(-1).push(view); else groups.push([view]);
    previous = view;
  }
  return groups;
}

// For every message in a chain of two or more (replies and continuations): the chain, its title and the message's position in it.
export function chains(views) {
  const result = new Map();
  for (const view of views) {
    if (result.has(view.id) || view.deleted) continue;
    const chain = related(views, view.id);
    if (chain.length < 2) continue;
    const root = chain[0];
    chain.forEach((item, index) => result.set(item.id, { ids: chain.map((entry) => entry.id), index, root: root.id, title: root.topicTitle || snippet(root), named: Boolean(root.topicTitle) }));
  }
  return result;
}
