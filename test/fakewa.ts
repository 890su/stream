// A fake WhatsApp linked-device connection for tests (src/whatsapp/types.ts): the test emits connection updates and
// messages, sees what was sent, and makes a send or a LID lookup fail. No Baileys, no network.
import type { SocketFactory, WaMessage, WaSocket, WaUpdate } from '../src/whatsapp/types.ts';

export class FakeSocket implements WaSocket {
  sent: { jid: string; text: string }[] = [];
  failSend = false;
  pn = new Map<string, string>();
  downloads = new Map<string, Buffer>();   // message id → file bytes; others fail to download
  ended = false;
  failEnd = false;                         // end() throws (a socket that is already gone)
  #updates: ((update: WaUpdate) => void)[] = [];
  #messages: ((upsert: { messages: WaMessage[]; type: string }) => Promise<void>)[] = [];
  #counter = 0;

  onUpdate(fn: (update: WaUpdate) => void): void { this.#updates.push(fn); }
  onMessages(fn: (upsert: { messages: WaMessage[]; type: string }) => Promise<void>): void { this.#messages.push(fn); }
  async sendText(jid: string, text: string): Promise<string> {
    if (this.failSend) throw new Error('fake send failed');
    this.sent.push({ jid, text });
    return `SENT${++this.#counter}`;
  }
  async download(message: WaMessage): Promise<Buffer> {
    const bytes = this.downloads.get(message.key.id ?? '');
    if (!bytes) throw new Error('no media in the fake');
    return bytes;
  }
  async pnForLid(lid: string): Promise<string | null> { return this.pn.get(lid) ?? null; }
  end(): void {
    if (this.failEnd) throw new Error('fake end failed');
    this.ended = true;
  }

  emitUpdate(update: WaUpdate): void { for (const fn of this.#updates) fn(update); }
  async emitMessages(messages: WaMessage[], type = 'notify'): Promise<void> { for (const fn of this.#messages) await fn({ messages, type }); }
}

export function fakeWa() {
  const sockets: FakeSocket[] = [];
  const dirs: string[] = [];
  const factory: SocketFactory = async (authDir) => { const socket = new FakeSocket(); sockets.push(socket); dirs.push(authDir); return socket; };
  return { factory, sockets, dirs, last: () => sockets.at(-1)! };
}

export async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
