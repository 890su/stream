import { randomUUID, createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JournalStore } from '../store/store.ts';
import type { MediaRef } from '../contracts/validate.ts';
import { captureConfig } from '../config.ts';
import { HttpError } from './errors.ts';
import { readBody } from './body.ts';
import type { LiveFeed } from './live.ts';

export async function share(request: IncomingMessage, response: ServerResponse, store: JournalStore, live: LiveFeed): Promise<void> {
  const bytes = await readBody(request, captureConfig.max_share_bytes);
  let form: FormData;
  try {
    form = await new Request('http://localhost/share-target', { method: 'POST', headers: { 'Content-Type': request.headers['content-type'] ?? '' }, body: new Uint8Array(bytes) }).formData();
  } catch { throw new HttpError(400, 'Некорректная форма «Поделиться»'); }
  const media: MediaRef[] = [];
  for (const file of form.getAll('files')) {
    if (!(file instanceof File)) throw new HttpError(400, 'Некорректный файл');
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = createHash('sha256').update(buffer).digest('hex');
    const result = store.putMedia(hash, file.type, buffer);
    media.push({ media_id: hash, mime: result.media.mime, size_bytes: result.media.size_bytes });
  }
  const text = ['title', 'text'].map((key) => form.get(key)).filter((value): value is string => typeof value === 'string').join('\n');
  const url = form.get('url');
  if (!text && typeof url !== 'string' && !media.length) throw new HttpError(400, 'Нет данных для сохранения');
  const result = store.appendEvent({ id: randomUUID(), schema_version: 1, source: 'share', author: 'me', ts: new Date().toISOString(),
    kind: media.length ? 'file' : url ? 'link' : 'text', payload: { text, ...(typeof url === 'string' ? { url } : {}), ...(media.length ? { media } : {}) } });
  if (result.created) live.publish(result.event);
  response.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' }); response.end();
}
