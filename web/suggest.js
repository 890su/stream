// Tag suggestions while typing (CONCEPT.md §2.2). Pure and local: works offline, no AI.
// Inputs: the draft text, the message history (projection views) and the registry dictionary.

const RECENT_MS = 30 * 24 * 3600 * 1000;
const TAG = /#[\p{L}0-9_-]+/gu;

export const normalizeTag = (tag) => tag.toLowerCase();

// Hashtags the owner typed into the text: they count as switched on by the owner.
export function typedTags(text) {
  return [...new Set((text.match(TAG) ?? []).map(normalizeTag))];
}

// Per tag: weighted use count and how often an automatic suggestion was kept or switched off.
export function tagStats(views, now = Date.now()) {
  const stats = new Map();
  const entry = (tag) => {
    if (!stats.has(tag)) stats.set(tag, { uses: 0, autoKept: 0, autoOff: 0 });
    return stats.get(tag);
  };
  for (const view of views) {
    if (view.deleted) continue;
    const age = now - Date.parse(view.event.ts);
    for (const tag of view.tags ?? []) entry(normalizeTag(tag)).uses += age <= RECENT_MS ? 1 : 0.5;
    const tagging = view.event.payload?.data?.tagging;
    for (const tag of tagging?.auto ?? []) entry(normalizeTag(tag)).autoKept += 1;
    for (const tag of tagging?.owner_off ?? []) entry(normalizeTag(tag)).autoOff += 1;
  }
  return stats;
}

function hintMatches(hints, text) {
  const words = text.split(/[^\p{L}0-9-]+/u).filter(Boolean);
  let count = 0;
  for (const hint of hints) {
    const needle = hint.toLowerCase();
    if (needle.includes(' ') ? text.includes(needle) : words.some((word) => word.startsWith(needle))) count += 1;
  }
  return count;
}

// Returns [{ tag, confidence, auto }] best first. `auto` = confident enough to switch on by itself.
export function suggestTags({ text = '', stats = new Map(), dictionary, limit = dictionary.suggest_limit, threshold = dictionary.auto_threshold }) {
  const lower = text.toLowerCase();
  const hints = new Map(dictionary.tags.map((entry) => [normalizeTag(entry.tag), entry.hints ?? []]));
  const candidates = new Set([...hints.keys(), ...stats.keys()]);
  const scored = [];
  for (const tag of candidates) {
    const stat = stats.get(tag) ?? { uses: 0, autoKept: 0, autoOff: 0 };
    const frequency = stat.uses / (stat.uses + 3);
    const matched = lower.trim() ? hintMatches(hints.get(tag) ?? [], lower) : 0;
    const match = 1 - 0.5 ** matched;
    // Switching an automatic tag off lowers trust in it next time.
    const trust = (stat.autoKept + 1) / (stat.autoKept + stat.autoOff + 1);
    const confidence = (1 - (1 - match) * (1 - 0.5 * frequency)) * trust;
    if (confidence <= 0) continue;
    scored.push({ tag, confidence: Math.round(confidence * 1000) / 1000, auto: matched > 0 && confidence >= threshold, uses: stat.uses });
  }
  return scored
    .sort((a, b) => b.confidence - a.confidence || b.uses - a.uses || a.tag.localeCompare(b.tag))
    .slice(0, limit)
    .map(({ tag, confidence, auto }) => ({ tag, confidence, auto }));
}
