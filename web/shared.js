// Builders of journal entries on the device: messages, shares, owner corrections, task changes.
export async function makeEntry({ kind = 'text', text = '', url, files = [], source = 'app', duration, tags = [], replyTo, tagging, continuation, outbound }) {
  const media = [];
  const storedFiles = [];
  for (const blob of files) {
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const id = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    media.push({ media_id: id, mime: blob.type, size_bytes: blob.size, ...(duration === undefined ? {} : { duration_s: duration }) });
    storedFiles.push({ id, blob });
  }
  return {
    event: {
      id: crypto.randomUUID(), schema_version: 1, source, author: 'me', ts: new Date().toISOString(), kind,
      ...(replyTo ? { reply_to: replyTo } : {}),
      payload: { ...(text ? { text } : {}), ...(url ? { url } : {}), ...(media.length ? { media } : {}), ...(tags.length ? { tags } : {}), ...(tagging || continuation || outbound ? { data: { ...(tagging ? { tagging } : {}), ...(continuation ? { continuation } : {}), ...(outbound ? { outbound } : {}) } } : {}) },
    },
    files: storedFiles,
  };
}

export async function entryFromShare(form) {
  const files = form.getAll('files').filter((value) => value instanceof Blob && value.size > 0);
  const text = ['title', 'text'].map((key) => form.get(key)).filter((value) => typeof value === 'string' && value).join('\n');
  const url = typeof form.get('url') === 'string' ? form.get('url') : undefined;
  if (!text && !url && !files.length) throw new Error('Нет данных для сохранения');
  return makeEntry({ source: 'share', kind: files.length ? 'file' : url ? 'link' : 'text', text, url, files });
}

// A UUID-shaped id from a stable key (version 5 layout over four FNV-1a hashes): the same act on this device always
// gets the same event id, so a double tap or a retry is dropped by the journal (rule 8). Not the server's `nameId`
// (src/ids.ts, sha256) — only stable per key, which is all an id needs.
export function nameUuid(key) {
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => {
    let hash = seed >>> 0;
    for (const char of `${seed}|${key}`) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
    return hash.toString(16).padStart(8, '0');
  });
  const hex = words.join('').split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const text = hex.join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

// A task change by the owner (CONCEPT.md §2.8): create (with the message it came from) or update. `id` / `ts` — a
// stable event id and time (askline.js), else new ones.
export function makeTaskChange(taskId, task, { id = crypto.randomUUID(), ts = new Date().toISOString() } = {}) {
  return {
    event: {
      id, schema_version: 1, source: 'app', author: 'me', ts, kind: 'task_change',
      payload: { ref: { type: 'task', id: taskId }, data: { task } },
    },
    files: [],
  };
}

// A project change by the owner (CONCEPT.md §2.11): create or update.
export function makeProjectChange(projectId, project) {
  return {
    event: {
      id: crypto.randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'project_change',
      payload: { ref: { type: 'project', id: projectId }, data: { project } },
    },
    files: [],
  };
}

// A person or a counterparty of the directory (contacts design §3), changed by the owner.
export function makePersonChange(personId, contact) {
  return { event: { id: crypto.randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'contact_change',
    payload: { ref: { type: 'person', id: personId }, data: { contact } } }, files: [] };
}
export function makeCounterpartyChange(counterpartyId, counterparty) {
  return { event: { id: crypto.randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'counterparty_change',
    payload: { ref: { type: 'counterparty', id: counterpartyId }, data: { counterparty } } }, files: [] };
}

// «Сделать задачей» / «Новое дело» by the owner: a task of mine from one message (P14 roles, no old `assignee`).
export function ownTask(title, messageId) {
  return { op: 'create', title, roles: { author: 'me', responsible: 'me', executors: ['me'] }, status: 'todo', add: [messageId] };
}

// An owner action on a message: edit, archive, unarchive, delete, restore (CONCEPT.md §2.4). An answer to the AI's
// question (`answer_question`, askline.js): `question` and an `option` index or the words in `answer`.
export function makeCorrection(targetId, op, { text, tags = [], target, title, until, proposal, question, option, answer, id = crypto.randomUUID(), ts = new Date().toISOString() } = {}) {
  return {
    event: {
      id, schema_version: 1, source: 'app', author: 'me', ts, kind: 'correction',
      payload: { ref: { type: 'event', id: targetId }, data: { op, ...(target ? { target } : {}), ...(title ? { title } : {}), ...(until ? { until } : {}), ...(proposal ? { proposal } : {}),
        ...(question ? { question } : {}), ...(option !== undefined ? { option } : {}), ...(answer ? { text: answer } : {}) }, ...(op === 'edit' ? { text: text ?? '', ...(tags.length ? { tags } : {}) } : {}) },
    },
    files: [],
  };
}
