import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JournalStore } from '../store/store.ts';
import { captureConfig } from '../config.ts';
import { HttpError } from './errors.ts';
import { json, readBody } from './body.ts';

export async function media(request: IncomingMessage, response: ServerResponse, id: string, store: JournalStore): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpError(400, 'Некорректный sha256');
  if (request.method === 'PUT') {
    const result = store.putMedia(id, request.headers['content-type'] ?? 'application/octet-stream', await readBody(request, captureConfig.max_media_bytes));
    const { path, ...metadata } = result.media;
    json(response, result.created ? 201 : 200, metadata);
    return;
  }
  if (request.method !== 'GET') throw new HttpError(405, 'Метод не поддерживается');
  const result = store.readMedia(id);
  if (!result) throw new HttpError(404, 'Файл не найден');
  const { bytes, media: metadata } = result;
  const headers = { 'Content-Type': metadata.mime, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Disposition': `inline; filename="${id}"`, 'Content-Security-Policy': 'sandbox' };
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match?.[2]));
    const end = match?.[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
    if (!match || (!match[1] && !match[2]) || start > end || start >= bytes.length) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${bytes.length}` }); response.end(); return;
    }
    response.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${bytes.length}` });
    response.end(bytes.subarray(start, end + 1)); return;
  }
  response.writeHead(200, { ...headers, 'Content-Length': bytes.length });
  response.end(bytes);
}
