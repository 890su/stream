// The «Темы» section of the System screen (topics design 2026-11-23): how long a topic stays live in a conversation —
// days without messages and days after its conversation left the queue. Saved by POST /api/settings/topics
// (src/ownersettings.ts). parseTopicSettings is pure; topicSettingsForm draws the two fields.

const whole = (text) => (/^\d+$/.test(String(text ?? '').trim()) ? Number(String(text).trim()) : null);

// { topic_days, archive_days } from the raw field values, or null unless both are whole numbers 1–365.
export function parseTopicSettings({ topic_days, archive_days }) {
  const topic = whole(topic_days);
  const archive = whole(archive_days);
  const ok = (value) => value !== null && value >= 1 && value <= 365;
  return ok(topic) && ok(archive) ? { topic_days: topic, archive_days: archive } : null;
}

function field(label, name, value) {
  const row = document.createElement('label');
  row.className = 'topic-setting';
  const input = Object.assign(document.createElement('input'), { type: 'number', min: 1, max: 365, step: 1, name, value: String(value) });
  input.inputMode = 'numeric';
  const text = document.createElement('span');
  text.textContent = label;
  row.append(text, input);
  return { row, input };
}

// `values` — { topic_days, archive_days }; `onSave(values)` — a promise; a bad value is said, not sent.
export function topicSettingsForm(values, onSave, notify) {
  const form = document.createElement('form');
  form.className = 'topic-settings';
  const topic = field('Тема актуальна без сообщений, дней', 'topic_days', values.topic_days);
  const archive = field('Темы бесед из архива доступны, дней', 'archive_days', values.archive_days);
  const save = Object.assign(document.createElement('button'), { type: 'submit', className: 'chip', textContent: 'Сохранить' });
  form.append(topic.row, archive.row, save);
  form.onsubmit = async (event) => {
    event.preventDefault();
    const parsed = parseTopicSettings({ topic_days: topic.input.value, archive_days: archive.input.value });
    if (!parsed) { notify('Сроки тем — целые числа дней от 1 до 365'); return; }
    await onSave(parsed);
  };
  return form;
}
