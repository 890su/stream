import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateEvent } from '../contracts/validate.ts';
import { checkCorrectionShape, checkCorrectionTarget } from '../contracts/correction.ts';
import { checkTagging } from '../contracts/tagging.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import { HttpError } from '../server/errors.ts';
import { captureConfig } from '../config.ts';

export interface MediaRecord { id: string; mime: string; size_bytes: number; path: string; created_at: string }
interface EventRow { id: string; schema_version: 1; source: string; author: string; ts: string; received_at: string; kind: string; payload: string; reply_to: string | null; topic_hint: string | null; body_hash: string }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fromRow(row: EventRow): JournalEvent {
  const { body_hash, payload, ...fields } = row;
  return { ...fields, payload: JSON.parse(payload) };
}

export class JournalStore {
  #db: DatabaseSync;
  #mediaDirectory: string;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.#mediaDirectory = join(directory, 'media');
    mkdirSync(this.#mediaDirectory, { recursive: true });
    this.#db = new DatabaseSync(join(directory, 'stream.db'));
    this.#db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  }

  close(): void { this.#db.close(); }

  backupTo(destination: string): void {
    mkdirSync(destination);
    try {
      this.#db.prepare('VACUUM INTO ?').run(join(destination, 'stream.db'));
      const snapshot = new DatabaseSync(join(destination, 'stream.db'), { readOnly: true });
      try {
        mkdirSync(join(destination, 'media'));
        const media = snapshot.prepare('SELECT path FROM media').all() as { path: string }[];
        for (const item of media) copyFileSync(join(this.#mediaDirectory, item.path), join(destination, 'media', item.path));
      } finally { snapshot.close(); }
    } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
  }

  appendEvent(input: JournalEvent): { created: boolean; event: JournalEvent } {
    validateEvent(input);
    checkCorrectionShape(input);
    checkTagging(input);
    // Server time is excluded, and omitted nullable fields have one canonical form.
    const { received_at, ...body } = input;
    const normalized = { ...body, reply_to: input.reply_to ?? null, topic_hint: input.topic_hint ?? null };
    const hash = createHash('sha256').update(canonical(normalized)).digest('hex');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.#db.prepare('SELECT * FROM events WHERE id = ?').get(input.id) as unknown as EventRow | undefined;
      if (existing) {
        if (existing.body_hash !== hash) throw new HttpError(409, 'Этот id уже принят с другим содержимым');
        this.#db.exec('COMMIT');
        return { created: false, event: fromRow(existing) };
      }
      if (input.kind === 'correction') checkCorrectionTarget(input, this.getEvent(input.payload.ref!.id));
      for (const reference of input.payload.media ?? []) {
        const media = this.getMedia(reference.media_id);
        if (!media) throw new HttpError(422, 'Сначала загрузите все медиа');
        if (reference.mime !== media.mime || (reference.size_bytes !== undefined && reference.size_bytes !== media.size_bytes)) {
          throw new HttpError(422, 'Метаданные медиа не совпадают с загруженным файлом');
        }
      }
      const latest = this.#db.prepare('SELECT received_at FROM events ORDER BY received_at DESC LIMIT 1').get() as { received_at: string } | undefined;
      const timestamp = new Date(Math.max(Date.now(), latest ? Date.parse(latest.received_at) + 1 : 0)).toISOString();
      this.#db.prepare(`INSERT INTO events
        (id, schema_version, source, author, ts, received_at, kind, payload, reply_to, topic_hint, body_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, input.schema_version, input.source, input.author,
        input.ts, timestamp, input.kind, JSON.stringify(input.payload), normalized.reply_to, normalized.topic_hint, hash);
      this.#db.exec('COMMIT');
      return { created: true, event: { ...normalized, received_at: timestamp } };
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }

  listEvents({ before, limit }: { before?: string; limit: number }): { events: JournalEvent[]; next_before: string | null } {
    const rows = (before
      ? this.#db.prepare('SELECT * FROM events WHERE received_at < ? ORDER BY received_at DESC LIMIT ?').all(before, limit + 1)
      : this.#db.prepare('SELECT * FROM events ORDER BY received_at DESC LIMIT ?').all(limit + 1)) as unknown as EventRow[];
    const events = rows.slice(0, limit).map(fromRow);
    return { events, next_before: rows.length > limit ? events.at(-1)!.received_at! : null };
  }

  getEvent(id: string): JournalEvent | undefined {
    const row = this.#db.prepare('SELECT * FROM events WHERE id = ?').get(id) as unknown as EventRow | undefined;
    return row && fromRow(row);
  }

  getMedia(id: string): MediaRecord | undefined {
    return this.#db.prepare('SELECT * FROM media WHERE id = ?').get(id) as unknown as MediaRecord | undefined;
  }

  putMedia(id: string, mime: string, bytes: Buffer): { created: boolean; media: MediaRecord } {
    if (!/^[a-f0-9]{64}$/.test(id) || createHash('sha256').update(bytes).digest('hex') !== id) throw new HttpError(400, 'Хеш медиа не совпадает');
    if (bytes.length > captureConfig.max_media_bytes) throw new HttpError(413, 'Файл слишком большой');
    const baseMime = mime.split(';')[0]!.trim().toLowerCase();
    const allowed = captureConfig.mime_types.some((type) => type.endsWith('/*') ? baseMime.startsWith(type.slice(0, -1)) : baseMime === type);
    if (!allowed) throw new HttpError(415, 'Формат файла не поддерживается');
    const existing = this.getMedia(id);
    if (existing && existsSync(join(this.#mediaDirectory, existing.path))) return { created: false, media: existing };
    const temporary = join(this.#mediaDirectory, `${id}.${randomUUID()}.tmp`);
    // Publish the complete file before its metadata. A retry repairs an interrupted upload.
    try {
      writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600, flush: true });
      renameSync(temporary, join(this.#mediaDirectory, id));
      this.#db.prepare('INSERT OR IGNORE INTO media (id, mime, size_bytes, path, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, mime, bytes.length, id, new Date().toISOString());
    } finally { rmSync(temporary, { force: true }); }
    return { created: !existing, media: this.getMedia(id)! };
  }

  readMedia(id: string): { media: MediaRecord; bytes: Buffer } | undefined {
    const media = this.getMedia(id);
    return media ? { media, bytes: readFileSync(join(this.#mediaDirectory, media.path)) } : undefined;
  }
}
