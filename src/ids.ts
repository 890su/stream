import { createHash } from 'node:crypto';

// A name-based UUID (version 5 layout over sha256) from a stable key: the same call, SMS or Telegram
// message always gets the same event id, so retries and reinstalls never write it twice.
// The Android companion derives call ids the same way (PhoneIds.kt).
export function nameId(key: string): string {
  const bytes = createHash('sha256').update(key, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
