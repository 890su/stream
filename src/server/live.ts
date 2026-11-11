import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JournalEvent } from '../contracts/validate.ts';

// Cloudflare closes a proxied connection after 100 s without bytes; a comment line keeps it open.
const HEARTBEAT_MS = 25_000;
const RETRY_MS = 3_000;

// Pushes newly appended journal events to every open client (Server-Sent Events).
// In-process only: one server, one owner (CONTEXT.md, rule 10).
export class LiveFeed {
  #clients = new Set<ServerResponse>();
  #heartbeat: NodeJS.Timeout | undefined;

  subscribe(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    response.write(`retry: ${RETRY_MS}\n: connected\n\n`);
    this.#clients.add(response);
    this.#heartbeat ??= setInterval(() => { for (const client of this.#clients) client.write(': ping\n\n'); }, HEARTBEAT_MS).unref();
    request.on('close', () => {
      this.#clients.delete(response);
      if (!this.#clients.size) { clearInterval(this.#heartbeat); this.#heartbeat = undefined; }
    });
  }

  publish(event: JournalEvent): void {
    const message = `event: append\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.#clients) client.write(message);
  }

  get size(): number { return this.#clients.size; }
}
