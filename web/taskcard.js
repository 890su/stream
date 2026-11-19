// The top of the task card and its folding sections (task card design §4): the line under the title (counterparty ·
// due · status), «дальше: …», a call and a map in one tap, and sections whose open state is remembered on the device.
// Pure helpers are tested in node; `section` builds a <details>.
import { STATUSES } from './taskfold.js';
import { dueLabel } from './tasklist.js';
import { phoneNumber } from './parties.js';

// counterparty · due · status (a plain «сделать» says nothing).
export function headline(task, now = new Date()) {
  const due = dueLabel(task, now);
  return [task.counterpartyTitle ? `◆ ${task.counterpartyTitle}` : '', due?.text ?? '', task.status === 'todo' ? '' : STATUSES[task.status] ?? task.status].filter(Boolean);
}

// What next: where I stopped (not the bare «в работе» of focus.js), else the first unticked item.
export function nextStep(task) {
  const note = task.resumeNote && task.resumeNote !== 'в работе' ? task.resumeNote : '';
  return note || task.items?.find((item) => !item.done)?.text || '';
}

const MAPS = 'https://www.google.com/maps/search/?api=1&query=';

// A call per phone of the person, a map per address of the person and the counterparty; the same address once.
export function contactLinks({ person = null, counterparty = null } = {}) {
  const calls = (person?.phones ?? []).map((phone) => ({ kind: 'tel', href: `tel:${phoneNumber(phone)}`, text: phone }));
  const addresses = [...new Set([...(person?.addresses ?? []), counterparty?.address].map((item) => String(item ?? '').trim()).filter(Boolean))];
  return [...calls, ...addresses.map((address) => ({ kind: 'map', href: `${MAPS}${encodeURIComponent(address)}`, text: address }))];
}

const KEY = 'stream.taskCard.';
function remembered(key, fallback) {
  try { const value = localStorage.getItem(KEY + key); return value === null ? fallback : value === '1'; } catch { return fallback; }
}

// A folding section of the card; its open state is kept on this device (unless `force` decides it this time).
export function section(key, title, nodes, { open = false, force = null } = {}) {
  const box = document.createElement('details');
  box.className = `card-section section-${key}`;
  box.open = force ?? remembered(key, open);
  const summary = document.createElement('summary');
  summary.className = 'picker-section';
  summary.textContent = title;
  box.append(summary, ...nodes);
  box.addEventListener('toggle', () => { try { localStorage.setItem(KEY + key, box.open ? '1' : '0'); } catch { /* storage may be blocked */ } });
  return box;
}
