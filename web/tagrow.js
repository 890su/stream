import { suggestTags, tagStats, typedTags, normalizeTag } from './suggest.js';

const SPARK = '<svg class="spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 13.8 10.2 20.5 12 13.8 13.8 12 20.5 10.2 13.8 3.5 12 10.2 10.2Z"/></svg>';
const TAG = /^#[\p{L}0-9_-]+$/u;

// The tag row above the composer: suggested (off), switched on by the owner, switched on automatically.
// Remembers what the owner did with suggestions, which is saved with the message as payload.data.tagging.
export function createTagRow({ dictionary, getViews, onChange }) {
  const row = document.querySelector('#tag-row');
  const options = document.querySelector('#tag-options');
  const owner = new Set(); // switched on by the owner (row, full list or new tag)
  const auto = new Set(); // switched on by the suggester and still on
  const off = new Set(); // switched on by the suggester, then switched off by the owner
  let typed = []; // hashtags written in the text: on while they are in the text
  const mutedTyped = new Set(); // typed hashtags the owner switched off in the row
  let suggestions = [];
  let shown = []; // inactive suggestions visible in the row at send time
  let statsSource;
  let stats = new Map();

  const currentStats = () => {
    const views = getViews();
    if (views !== statsSource) { statsSource = views; stats = tagStats(views); } // recomputed once per feed render
    return stats;
  };
  const typedOn = () => typed.filter((tag) => !mutedTyped.has(tag));
  const active = () => [...new Set([...owner, ...typedOn(), ...auto])];

  function update(text = '') {
    typed = typedTags(text);
    suggestions = suggestTags({ text, stats: currentStats(), dictionary });
    // An automatic tag follows the text: it goes away when the text no longer supports it.
    const confident = new Set(suggestions.filter((item) => item.auto).map((item) => item.tag));
    for (const tag of [...auto]) if (!confident.has(tag)) auto.delete(tag);
    for (const tag of confident) if (!off.has(tag) && !owner.has(tag) && !typed.includes(tag)) auto.add(tag);
    render();
  }

  function toggle(tag) {
    if (auto.has(tag)) { auto.delete(tag); off.add(tag); }
    else if (owner.has(tag)) owner.delete(tag);
    else if (typed.includes(tag) && !mutedTyped.has(tag)) mutedTyped.add(tag);
    else { owner.add(tag); off.delete(tag); mutedTyped.delete(tag); }
    render();
  }

  function chip(tag, state) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip ${state}`;
    button.dataset.tag = tag;
    button.setAttribute('aria-pressed', String(state !== 'suggest'));
    button.setAttribute('aria-label', state === 'auto' ? `${tag}, включена автоматически` : tag);
    if (state === 'auto') button.innerHTML = SPARK;
    button.append(tag);
    button.onclick = () => toggle(tag);
    return button;
  }

  function render() {
    const on = active();
    const autoOn = new Set(auto);
    // Switched-off automatic tags stay in the row, inactive, so one tap brings them back.
    shown = [...new Set([...off, ...suggestions.map((item) => item.tag)])].filter((tag) => !on.includes(tag));
    row.replaceChildren(...on.map((tag) => chip(tag, autoOn.has(tag) ? 'auto' : 'on')), ...shown.map((tag) => chip(tag, 'suggest')));
    row.hidden = !row.childElementCount;
    // Full list behind the # button: dictionary and every tag used before.
    const all = [...new Set([...dictionary.tags.map((entry) => normalizeTag(entry.tag)), ...currentStats().keys(), ...on])].sort((a, b) => a.localeCompare(b, 'ru'));
    options.replaceChildren(...all.map((tag) => chip(tag, on.includes(tag) ? (autoOn.has(tag) ? 'auto' : 'on') : 'suggest')));
    onChange(on);
  }

  function addNew(raw) {
    const tag = normalizeTag(raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`);
    if (!TAG.test(tag)) return false;
    owner.add(tag); off.delete(tag); render();
    return true;
  }

  function reset(initial = []) {
    owner.clear(); auto.clear(); off.clear(); mutedTyped.clear(); typed = [];
    for (const tag of initial) owner.add(normalizeTag(tag));
  }

  // Feedback for this message; omitted when the suggester showed nothing and no tag was set.
  function tagging() {
    const on = active();
    const autoList = on.filter((tag) => auto.has(tag));
    const result = {
      engine: dictionary.engine, suggested: shown.filter((tag) => !on.includes(tag) && !off.has(tag)), auto: autoList,
      owner_on: on.filter((tag) => !auto.has(tag)), owner_off: [...off].filter((tag) => !on.includes(tag)),
    };
    return Object.values(result).some((value) => Array.isArray(value) && value.length) ? result : undefined;
  }

  return { update, reset, active, tagging, addNew, render };
}
