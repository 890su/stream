import type { DatabaseSync } from 'node:sqlite';
import { telegramConfig } from '../config.ts';
import type { ConnectionStore } from './connections.ts';
import type { TelegramQueries } from './telegram.ts';

// The address book of the «кому» row (CONCEPT.md §2.9): chats and groups a message can be sent to.
// A projection of the journal (Telegram messages, replies sent from the feed, pin / unpin corrections) and of
// the groups the account bots are members of. Frequency is counted, not stored.

export interface Recipient {
  key: string; account: string; chat_id: string; title: string; group: boolean;
  count: number; last_at: string | null; pinned: boolean; window_open: boolean;
  anchor: string | null; // a message of the chat: pin / unpin corrections name the chat through it
}

interface ChatRow { account: string; chat_id: string; title: string | null; chat_type: string | null; n: number; last_at: string; last_in: string | null; anchor: string }

export class RecipientQueries {
  #db: DatabaseSync;
  #connections: ConnectionStore;
  #telegram: TelegramQueries;
  constructor(db: DatabaseSync, connections: ConnectionStore, telegram: TelegramQueries) { this.#db = db; this.#connections = connections; this.#telegram = telegram; }

  list(now = Date.now()): Recipient[] {
    const since = new Date(now - telegramConfig.address_book.frequent_days * 86_400_000).toISOString();
    const windowFrom = new Date(now - telegramConfig.reply_window_h * 3_600_000).toISOString();
    const chats = new Map<string, Recipient>();
    const add = (row: ChatRow, outbound: boolean) => {
      const key = `${row.account}|${row.chat_id}`;
      const known = chats.get(key);
      const group = row.chat_type ? row.chat_type === 'group' : row.chat_id.startsWith('-');
      const item = known ?? { key, account: row.account, chat_id: row.chat_id, title: '', group, count: 0, last_at: null, pinned: false, window_open: group, anchor: null };
      item.count += row.n;
      if (!item.last_at || row.last_at > item.last_at) {
        item.last_at = row.last_at; item.anchor = row.anchor;
        if (row.title && (!outbound || !item.title)) item.title = row.title;
      }
      if (!item.title && row.title) item.title = row.title;
      if (!group && row.last_in && row.last_in >= windowFrom) item.window_open = true;
      chats.set(key, item);
    };
    // SQLite takes the bare columns (title, anchor) from the row of max(ts).
    const incoming = this.#db.prepare(`SELECT json_extract(payload, '$.data.telegram.account') AS account, json_extract(payload, '$.data.telegram.chat_id') AS chat_id,
        sum(ts >= ?) AS n, max(ts) AS last_at, max(CASE WHEN author != 'me' THEN ts END) AS last_in, id AS anchor,
        coalesce(json_extract(payload, '$.data.telegram.chat_title'), json_extract(payload, '$.data.telegram.from_name')) AS title,
        json_extract(payload, '$.data.telegram.chat_type') AS chat_type
      FROM events WHERE source = 'telegram' AND kind != 'correction' GROUP BY account, chat_id`).all(since) as unknown as ChatRow[];
    for (const row of incoming) if (row.account && row.chat_id) add(row, false);
    const replies = this.#db.prepare(`SELECT json_extract(payload, '$.data.outbound.connector') AS connector, json_extract(payload, '$.data.outbound.chat_id') AS chat_id,
        sum(ts >= ?) AS n, max(ts) AS last_at, NULL AS last_in, id AS anchor, json_extract(payload, '$.data.outbound.chat_title') AS title, NULL AS chat_type
      FROM events WHERE kind = 'text' AND json_extract(payload, '$.data.outbound') IS NOT NULL GROUP BY connector, chat_id`).all(since) as unknown as (ChatRow & { connector: string })[];
    for (const row of replies) {
      const account = Object.entries(telegramConfig.accounts).find(([, item]) => item.connector === row.connector)?.[0];
      if (account) add({ ...row, account }, true);
    }
    // Groups the bot is in are recipients even before anyone writes there; a group it left or that a
    // stranger added cannot be written to.
    for (const group of this.#connections.groups()) {
      const key = `${group.account}|${group.chat_id}`;
      const known = chats.get(key);
      if (!group.allowed) chats.delete(key);
      else if (known) { known.group = true; known.window_open = true; if (group.title) known.title = group.title; }
      else chats.set(key, { key, account: group.account, chat_id: group.chat_id, title: group.title ?? 'Группа', group: true, count: 0, last_at: null, pinned: false, window_open: true, anchor: null });
    }
    for (const excluded of this.#telegram.exclusions()) chats.delete(`${excluded.account}|${excluded.chat_id}`);
    for (const key of this.#pins()) { const item = chats.get(key); if (item) item.pinned = true; }
    for (const item of chats.values()) if (!item.title) item.title = item.group ? 'Группа' : 'Чат';
    return [...chats.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.count - a.count || (b.last_at ?? '').localeCompare(a.last_at ?? ''));
  }

  // Chats pinned by the owner: the latest pin / unpin per chat wins.
  #pins(): Set<string> {
    const rows = this.#db.prepare(`SELECT json_extract(c.payload, '$.data.op') AS op,
        coalesce(json_extract(t.payload, '$.data.telegram.account'), json_extract(t.payload, '$.data.outbound.connector')) AS account,
        coalesce(json_extract(t.payload, '$.data.telegram.chat_id'), json_extract(t.payload, '$.data.outbound.chat_id')) AS chat_id
      FROM events c JOIN events t ON t.id = json_extract(c.payload, '$.ref.id')
      WHERE c.kind = 'correction' AND json_extract(c.payload, '$.data.op') IN ('pin', 'unpin') ORDER BY c.ts, c.received_at`).all() as { op: string; account: string; chat_id: string }[];
    const state = new Map<string, boolean>();
    for (const row of rows) {
      const account = Object.entries(telegramConfig.accounts).find(([key, item]) => key === row.account || item.connector === row.account)?.[0];
      if (account && row.chat_id) state.set(`${account}|${row.chat_id}`, row.op === 'pin');
    }
    return new Set([...state].filter(([, on]) => on).map(([key]) => key));
  }
}
