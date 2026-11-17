import type { DatabaseSync } from 'node:sqlite';

// Read-only questions about Telegram messages in the journal (CONCEPT.md §8.2).

export interface Exclusion { account: string; chat_id: string; chat_title: string; message: string; at: string }

export class TelegramQueries {
  #db: DatabaseSync;
  constructor(db: DatabaseSync) { this.#db = db; }

  // Chats switched off with «Не отслеживать» and not switched back: the latest untrack/track per chat wins.
  // A chat is named through one of its messages, so the list is a projection of owner corrections.
  exclusions(account?: string): Exclusion[] {
    const rows = this.#db.prepare(`SELECT json_extract(c.payload, '$.data.op') AS op, c.ts AS at, t.id AS message,
        json_extract(t.payload, '$.data.telegram.account') AS account, json_extract(t.payload, '$.data.telegram.chat_id') AS chat_id,
        coalesce(json_extract(t.payload, '$.data.telegram.chat_title'), json_extract(t.payload, '$.data.telegram.from_name'), '') AS chat_title
      FROM events c JOIN events t ON t.id = json_extract(c.payload, '$.ref.id')
      WHERE c.kind = 'correction' AND json_extract(c.payload, '$.data.op') IN ('untrack', 'track')
      ORDER BY c.ts, c.received_at`).all() as unknown as (Exclusion & { op: string })[];
    const chats = new Map<string, Exclusion & { op: string }>();
    for (const row of rows) if (row.account && row.chat_id) chats.set(`${row.account}|${row.chat_id}`, row);
    return [...chats.values()].filter((row) => row.op === 'untrack' && (!account || row.account === account))
      .map(({ op, ...exclusion }) => exclusion);
  }

  // The message a forward came from: same author and same original time, in another chat.
  forwardOrigin(fromId: string, date: string, notInChat: string): string | undefined {
    const row = this.#db.prepare(`SELECT id FROM events WHERE source = 'telegram' AND kind != 'correction'
        AND json_extract(payload, '$.data.telegram.from_id') = ? AND json_extract(payload, '$.data.telegram.sent_at') = ?
        AND json_extract(payload, '$.data.telegram.chat_id') != ? ORDER BY received_at LIMIT 1`)
      .get(fromId, date, notInChat) as { id: string } | undefined;
    return row?.id;
  }

  albumFirst(account: string, chatId: string, albumId: string): string | undefined {
    const row = this.#db.prepare(`SELECT id FROM events WHERE source = 'telegram' AND kind != 'correction'
        AND json_extract(payload, '$.data.telegram.account') = ? AND json_extract(payload, '$.data.telegram.chat_id') = ?
        AND json_extract(payload, '$.data.telegram.album_id') = ? ORDER BY json_extract(payload, '$.data.telegram.message_id') LIMIT 1`)
      .get(account, chatId, albumId) as { id: string } | undefined;
    return row?.id;
  }

  // The newest incoming message of a chat: replies through a bot are possible for 24 hours after it.
  lastIncomingAt(account: string, chatId: string): string | undefined {
    const row = this.#db.prepare(`SELECT max(ts) AS at FROM events WHERE source = 'telegram' AND kind != 'correction' AND author != 'me'
        AND json_extract(payload, '$.data.telegram.account') = ? AND json_extract(payload, '$.data.telegram.chat_id') = ?`)
      .get(account, chatId) as { at: string | null };
    return row.at ?? undefined;
  }

  lastMessageAt(account: string): string | undefined {
    const row = this.#db.prepare(`SELECT max(ts) AS at FROM events WHERE source = 'telegram' AND kind != 'correction'
        AND json_extract(payload, '$.data.telegram.account') = ?`).get(account) as { at: string | null };
    return row.at ?? undefined;
  }
}
