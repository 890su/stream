import { readFileSync } from 'node:fs';
import { HttpError } from '../server/errors.ts';

export interface MediaRef {
  media_id: string;
  mime: string;
  duration_s?: number;
  size_bytes?: number;
}

export interface JournalEvent {
  id: string;
  schema_version: 1;
  source: string;
  author: string;
  ts: string;
  received_at?: string;
  kind: string;
  payload: {
    text?: string; url?: string; media?: MediaRef[]; tags?: string[];
    ref?: { type: string; id: string }; data?: Record<string, unknown>;
  };
  reply_to?: string | null;
  topic_hint?: string | null;
}

interface Schema {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, Schema>;
  items?: Schema;
  minimum?: number;
  pattern?: string;
  format?: string;
}

const schema = JSON.parse(readFileSync(new URL('../../contracts/event.schema.json', import.meta.url), 'utf8')) as Schema;

export function isDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= days
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60
    && Number(offsetHour ?? 0) < 24 && Number(offsetMinute ?? 0) < 60;
}

// This interpreter supports the vocabulary used by the v1 event contract.
function check(value: unknown, rule: Schema, path: string): void {
  const fail = (reason: string): never => { throw new HttpError(400, `${path} ${reason}`); };
  const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const types = Array.isArray(rule.type) ? rule.type : [rule.type];
  if (rule.type && !types.some((type) => type === actualType || (type === 'integer' && Number.isInteger(value)))) fail('имеет неверный тип');
  if ('const' in rule && value !== rule.const) fail('имеет неподдерживаемую версию');
  if (rule.enum && !rule.enum.includes(value)) fail('имеет недопустимое значение');
  if (typeof value === 'number' && (!Number.isFinite(value) || (rule.minimum !== undefined && value < rule.minimum))) fail('вне допустимого диапазона');
  if (typeof value === 'string') {
    if (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)) fail('имеет неверный формат');
    if (rule.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail('должен быть UUID');
    if (rule.format === 'date-time' && !isDateTime(value)) fail('должен быть датой ISO 8601');
  }
  if (Array.isArray(value) && rule.items) value.forEach((item, index) => check(item, rule.items!, `${path}[${index}]`));
  if (actualType === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of rule.required ?? []) if (!Object.hasOwn(object, key)) fail(`не содержит обязательное поле ${key}`);
    for (const [key, item] of Object.entries(object)) {
      if (rule.properties && Object.hasOwn(rule.properties, key)) check(item, rule.properties[key]!, `${path}.${key}`);
      else if (rule.additionalProperties === false) fail(`содержит лишнее поле ${key}`);
    }
  }
}

export function validateEvent(value: unknown): asserts value is JournalEvent {
  check(value, schema, 'event');
}
