import { readFileSync } from 'node:fs';

export const captureConfig = JSON.parse(readFileSync(new URL('../registry/capture.json', import.meta.url), 'utf8')) as {
  max_event_bytes: number; max_media_bytes: number; max_share_bytes: number;
  default_page_size: number; max_page_size: number; mime_types: string[];
  min_owner_token_length: number;
  burst_gap_min: number; collapse_chars: number; collapse_lines: number;
};

// Tag dictionary (CONCEPT.md §2.2): suggestion hints, auto-activation threshold, engine version.
export const tagConfig = JSON.parse(readFileSync(new URL('../registry/tags.json', import.meta.url), 'utf8')) as {
  version: number; engine: string; auto_threshold: number; suggest_limit: number;
  tags: Array<{ tag: string; intent?: string; hints: string[] }>;
};

// Telegram account bots (CONCEPT.md §8.2): accounts, file limit, reply window, silence threshold.
export const telegramConfig = JSON.parse(readFileSync(new URL('../registry/telegram.json', import.meta.url), 'utf8')) as {
  version: number;
  accounts: Record<string, { title: string; connector: string; sphere: string; timezone: string }>;
  media_max_bytes: number; silent_after_s: number; reply_window_h: number;
};
