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

// A task change by the owner (CONCEPT.md §2.8): create (with the message it came from) or update.
export function makeTaskChange(taskId, task) {
  return {
    event: {
      id: crypto.randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'task_change',
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
export function makeCorrection(targetId, op, { text, tags = [], target, title, until, proposal, question, option, answer } = {}) {
  return {
    event: {
      id: crypto.randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'correction',
      payload: { ref: { type: 'event', id: targetId }, data: { op, ...(target ? { target } : {}), ...(title ? { title } : {}), ...(until ? { until } : {}), ...(proposal ? { proposal } : {}),
        ...(question ? { question } : {}), ...(option !== undefined ? { option } : {}), ...(answer ? { text: answer } : {}) }, ...(op === 'edit' ? { text: text ?? '', ...(tags.length ? { tags } : {}) } : {}) },
    },
    files: [],
  };
}
