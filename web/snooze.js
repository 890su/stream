// «⏱ Отложить» (CONCEPT.md §5, docs/plans/2026-11-20-queue-and-task-screen-design.md): until when a conversation
// leaves the queue. The choices depend on the time of day (presets — registry/conversations.json `queue.snooze`):
// minutes always, noon only in the morning, the evening until late afternoon, then «завтра днём», and the next
// morning. snoozeOptions is pure (tested in node); snoozeMenu is the small popover with the icons and «📅».

const MINUTES = { 15: ['15m', '☕', '15 мин'], 60: ['1h', '🕐', '1 ч'], 180: ['3h', '🕒', '3 ч'] };
const at = (base, days, hour) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, hour, 0, 0, 0);

// [{ key, icon, label, until (ISO) }] in the order they are shown.
export function snoozeOptions(now, config) {
  const preset = config.queue.snooze;
  const hour = now.getHours() + now.getMinutes() / 60;
  const options = preset.minutes.map((minutes) => {
    const [key, icon, label] = MINUTES[minutes] ?? [`${minutes}m`, '⏱', `${minutes} мин`];
    return { key, icon, label, until: new Date(now.getTime() + minutes * 60_000).toISOString() };
  });
  if (hour < preset.noon.until_hour) options.push({ key: 'noon', icon: '🌞', label: 'в полдень', until: at(now, 0, preset.noon.hour).toISOString() });
  if (hour < preset.evening.until_hour) options.push({ key: 'evening', icon: '🌆', label: 'вечером', until: at(now, 0, preset.evening.hour).toISOString() });
  if (hour >= preset.tomorrow_day.from_hour) options.push({ key: 'tomorrow_day', icon: '🌤', label: 'завтра днём', until: at(now, 1, preset.tomorrow_day.hour).toISOString() });
  // The next morning ahead: after midnight it is this morning.
  const morning = hour < preset.morning.hour ? at(now, 0, preset.morning.hour) : at(now, 1, preset.morning.hour);
  options.push({ key: 'morning', icon: '🌅', label: 'утром', until: morning.toISOString() });
  return options;
}

// The dials a left swipe on a queue tile shows in its place (owner, 2026-11-22; registry/conversations.json
// `queue.swipe`): minutes, the parts of the day, a date — today and the next days. → { minutes: [n],
// parts: [{ key, label, icon, hour }], days: [{ offset, label }], day_hour }.
const SWIPE_DEFAULTS = { minutes: [5, 15, 25, 55], parts: [{ key: 'morning', label: 'утро', icon: '🌅', hour: 9 }, { key: 'day', label: 'день', icon: '🌞', hour: 13 },
  { key: 'evening', label: 'вечер', icon: '🌆', hour: 18 }, { key: 'night', label: 'ночь', icon: '🌙', hour: 22 }], days: 10, day_hour: 9 };
const weekdayDay = new Intl.DateTimeFormat('ru', { weekday: 'short', day: 'numeric' });

// A day `offset` days from today, in words: «сегодня», «завтра», «пн, 24».
export const dayWord = (now, offset) => (offset === 0 ? 'сегодня' : offset === 1 ? 'завтра' : weekdayDay.format(at(now, offset, 12)));

export function swipeChoices(now, config) {
  const preset = { ...SWIPE_DEFAULTS, ...(config.queue?.swipe ?? {}) };
  const days = Array.from({ length: preset.days + 1 }, (_, offset) => ({ offset, label: dayWord(now, offset) }));
  return { minutes: preset.minutes, parts: preset.parts, days, day_hour: preset.day_hour };
}

// Until when the dialled choice puts the conversation off, as ISO; null — nothing dialled (the archive with no date).
// `pick` — { minutes } or { part (key), day (offset from today) }: minutes count from now; a part of the day is that
// hour of the day (today without a date); a date alone — its morning; a time already gone moves to the next day.
export function composeUntil(now, pick, choices) {
  if (pick.minutes) return new Date(now.getTime() + pick.minutes * 60_000).toISOString();
  if (pick.part === undefined && pick.day === undefined) return null;
  const hour = choices.parts.find((part) => part.key === pick.part)?.hour ?? choices.day_hour;
  let until = at(now, pick.day ?? 0, hour);
  if (until.getTime() <= now.getTime()) until = at(now, (pick.day ?? 0) + 1, hour);
  return until.toISOString();
}

// A date and time from the system picker, as ISO; null if cancelled.
export function pickDateTime(now = new Date()) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'snooze-date';
    const pad = (n) => String(n).padStart(2, '0');
    input.min = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    let done = false;
    const finish = (value) => { if (done) return; done = true; input.remove(); resolve(value); };
    input.onchange = () => finish(input.value ? new Date(input.value).toISOString() : null);
    input.onblur = () => setTimeout(() => finish(null), 300);
    document.body.append(input);
    try { input.showPicker(); } catch { input.focus(); }
  });
}

// The popover under `anchor`: one button per option and «📅 дата»; a tap outside or Escape closes it.
export function snoozeMenu(anchor, { now = new Date(), config, onPick }) {
  document.querySelector('.snooze-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'snooze-menu';
  menu.setAttribute('role', 'menu');
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  const outside = (event) => { if (!menu.contains(event.target)) close(); };
  const escape = (event) => { if (event.key === 'Escape') close(); };
  const item = (icon, label, run) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    const mark = document.createElement('span');
    mark.className = 'snooze-icon';
    mark.textContent = icon;
    button.append(mark, label);
    button.onclick = (event) => { event.stopPropagation(); close(); run(); };
    return button;
  };
  for (const option of snoozeOptions(now, config)) menu.append(item(option.icon, option.label, () => onPick(option.until)));
  menu.append(item('📅', 'дата', async () => { const until = await pickDateTime(now); if (until) onPick(until); }));
  document.body.append(menu);
  const box = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8))}px`;
  const below = box.bottom + 4;
  menu.style.top = `${below + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, box.top - menu.offsetHeight - 4) : below}px`;
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape); });
  return { close };
}
