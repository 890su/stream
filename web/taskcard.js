// The top of the task card and its folding sections (task card design §4): the line under the title (counterparty ·
// due · status), «дальше: …», a call and a map in one tap, and sections whose open state is remembered on the device.
// Pure helpers are tested in node; `section` builds a <details>, `cardTabs` the tabs of the card.
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

// The tab to show: the remembered one if the card has it, else the first.
export const pickTab = (stored, ids) => (ids.includes(stored) ? stored : ids[0]);

// Tabs of the card (owner's design, 2026-11-19): Переписка · Участники · Подробности · Лог. The choice is kept on this
// device; a screen swipe in the panel moves between them (swipezones.js reads [data-swipe-tabs] and its role=tab
// buttons). `tabs`: [{ id, title, count, badge, nodes() }] — the content is built when its tab opens.
export function cardTabs(tabs, { slide = () => {} } = {}) {
  const box = document.createElement('div');
  box.className = 'card-tabs-box';
  const bar = document.createElement('div');
  bar.className = 'card-tabs';
  bar.setAttribute('role', 'tablist');
  bar.dataset.swipeTabs = '';
  const panel = document.createElement('div');
  panel.className = 'card-tab-panel';
  panel.setAttribute('role', 'tabpanel');
  let stored = null;
  try { stored = localStorage.getItem(`${KEY}tab`); } catch { /* storage may be blocked */ }
  let current = pickTab(stored, tabs.map((tab) => tab.id));
  const buttons = tabs.map((tab) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'card-tab';
    node.setAttribute('role', 'tab');
    node.textContent = tab.title;
    if (tab.count) node.append(Object.assign(document.createElement('span'), { className: 'card-tab-count', textContent: String(tab.count) }));
    if (tab.badge) node.append(Object.assign(document.createElement('span'), { className: 'card-tab-badge', textContent: '•', title: 'Нужен ответ' }));
    node.onclick = () => {
      if (tab.id === current) return;
      const dir = tabs.findIndex((item) => item.id === tab.id) > tabs.findIndex((item) => item.id === current) ? 'next' : 'prev';
      current = tab.id;
      try { localStorage.setItem(`${KEY}tab`, current); } catch { /* storage may be blocked */ }
      draw();
      slide(panel, dir);
    };
    return node;
  });
  function draw() {
    tabs.forEach((tab, index) => {
      buttons[index].setAttribute('aria-selected', String(tab.id === current));
      buttons[index].classList.toggle('on', tab.id === current);
    });
    panel.replaceChildren(...tabs.find((tab) => tab.id === current).nodes());
  }
  bar.append(...buttons);
  draw();
  box.append(bar, panel);
  return box;
}
