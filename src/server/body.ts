import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './errors.ts';

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  // Do not destroy the socket on a size failure, so the caller can receive 413.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) { request.resume(); throw new HttpError(413, 'Запись слишком большая'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
