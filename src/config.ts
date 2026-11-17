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

// Task triage (CONCEPT.md §2.8): quiet window, AI model and budget, task templates.
export const tasksConfig = JSON.parse(readFileSync(new URL('../registry/tasks.json', import.meta.url), 'utf8')) as {
  version: number; quiet_s: number; lookback_h: number; max_batch: number; open_tasks_in_context: number; low_confidence: number;
  ai: { provider: string; model: string; effort: string; max_tokens: number; monthly_budget_usd: number; price_per_mtok: { input: number; output: number }; processor: string };
  assignees: string[];
  templates: Array<{ name: string; tag: string; title: string; assignee: string; instruction: string }>;
};
