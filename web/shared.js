export async function makeEntry({ kind = 'text', text = '', url, files = [], source = 'app', duration }) {
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
      payload: { ...(text ? { text } : {}), ...(url ? { url } : {}), ...(media.length ? { media } : {}) },
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
