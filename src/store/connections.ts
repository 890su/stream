import type { DatabaseSync } from 'node:sqlite';

// Telegram business connections, trusted accounts and groups of the account bots (CONCEPT.md §8.2).
// Current state, not history: the journal gets `system` notes when something needs the owner.

export interface Connection { id: string; account: string; user_id: string; user_name: string | null; can_reply: boolean; enabled: boolean; updated_at: string; trusted: boolean | null }
export interface Group { account: string; chat_id: string; title: string | null; added_by: string | null; member: boolean; allowed: boolean; updated_at: string }

type Row = Omit<Connection, 'can_reply' | 'enabled' | 'trusted'> & { can_reply: number; enabled: number; trusted: number | null };

const fromRow = (row: Row): Connection => ({ ...row, can_reply: Boolean(row.can_reply), enabled: Boolean(row.enabled), trusted: row.trusted === null ? null : Boolean(row.trusted) });
const SELECT = `SELECT c.*, t.trusted AS trusted FROM tg_connections c LEFT JOIN tg_trust t ON t.account = c.account AND t.user_id = c.user_id`;

export class ConnectionStore {
  #db: DatabaseSync;
  constructor(db: DatabaseSync) { this.#db = db; }

  get(id: string): Connection | undefined {
    const row = this.#db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as unknown as Row | undefined;
    return row && fromRow(row);
  }

  // Returns the connection as stored, with the owner's trust decision (null — not decided yet).
  save(connection: Omit<Connection, 'updated_at' | 'trusted'>): Connection {
    this.#db.prepare(`INSERT INTO tg_connections (id, account, user_id, user_name, can_reply, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_name = excluded.user_name, can_reply = excluded.can_reply, enabled = excluded.enabled, updated_at = excluded.updated_at`)
      .run(connection.id, connection.account, connection.user_id, connection.user_name, Number(connection.can_reply), Number(connection.enabled), new Date().toISOString());
    return this.get(connection.id)!;
  }

  list(): Connection[] {
    return (this.#db.prepare(`${SELECT} ORDER BY c.updated_at DESC`).all() as unknown as Row[]).map(fromRow);
  }

  // The connection replies go through: trusted, enabled, the newest.
  active(account: string): Connection | undefined {
    const row = this.#db.prepare(`${SELECT} WHERE c.account = ? AND c.enabled = 1 AND t.trusted = 1 ORDER BY c.updated_at DESC LIMIT 1`).get(account) as unknown as Row | undefined;
    return row && fromRow(row);
  }

  trusted(account: string): Set<string> {
    const rows = this.#db.prepare('SELECT user_id FROM tg_trust WHERE account = ? AND trusted = 1').all(account) as { user_id: string }[];
    return new Set(rows.map((row) => row.user_id));
  }

  decide(account: string, userId: string, trusted: boolean): void {
    this.#db.prepare(`INSERT INTO tg_trust (account, user_id, trusted, decided_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(account, user_id) DO UPDATE SET trusted = excluded.trusted, decided_at = excluded.decided_at`)
      .run(account, userId, Number(trusted), new Date().toISOString());
  }

  // Who added the bot is kept; whether the group is read follows the owner's trust in that account, so
  // a group added before the connection was confirmed starts being read once it is (no leaving, no re-adding).
  setGroup(account: string, chatId: string, title: string | null, addedBy: string | null, member: boolean): void {
    this.#db.prepare(`INSERT INTO tg_groups (account, chat_id, title, added_by, member, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account, chat_id) DO UPDATE SET title = excluded.title, added_by = coalesce(excluded.added_by, tg_groups.added_by),
        member = excluded.member, updated_at = excluded.updated_at`)
      .run(account, chatId, title, addedBy, Number(member), new Date().toISOString());
  }

  groupAllowed(account: string, chatId: string): boolean {
    return Boolean(this.#db.prepare(`SELECT 1 FROM tg_groups g JOIN tg_trust t ON t.account = g.account AND t.user_id = g.added_by AND t.trusted = 1
      WHERE g.account = ? AND g.chat_id = ? AND g.member = 1`).get(account, chatId));
  }

  groups(): Group[] {
    const rows = this.#db.prepare(`SELECT g.*, coalesce(t.trusted, 0) AS allowed FROM tg_groups g
      LEFT JOIN tg_trust t ON t.account = g.account AND t.user_id = g.added_by ORDER BY g.updated_at DESC`).all() as unknown as (Omit<Group, 'allowed' | 'member'> & { allowed: number; member: number })[];
    return rows.map((row) => ({ ...row, member: Boolean(row.member), allowed: Boolean(row.allowed) && Boolean(row.member) }));
  }
}
