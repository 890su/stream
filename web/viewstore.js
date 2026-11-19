// The task view kept on this device (viewstate.js): the current view, «Мои виды» (saved views) and the layout of the
// left panel (axes · lists · tree). Changes call the listeners (the centre and the panel redraw). Tested in node with a
// fake storage. Saved views are per device for now; across devices — later, as journal events.
import { DEFAULT_VIEW } from './viewstate.js';

const KEYS = { view: 'stream.taskView.v1', saved: 'stream.taskViews.saved.v1', layout: 'stream.taskPanel.layout' };
export const LAYOUTS = [
  { id: 'axes', title: 'Оси: когда · чьё · где' },
  { id: 'lists', title: 'Списки, как в TickTick' },
  { id: 'tree', title: 'Дерево, как в Things' },
];

const browserStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function createViewStore(storage = browserStorage()) {
  const read = (key, fallback) => { try { const raw = storage?.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
  const write = (key, value) => { try { storage?.setItem(key, JSON.stringify(value)); } catch { /* storage may be blocked */ } };
  let view = { ...DEFAULT_VIEW, ...read(KEYS.view, {}) };
  view.where = { ...(view.where ?? {}) };
  let saved = read(KEYS.saved, []);
  let layout = read(KEYS.layout, 'axes');
  const listeners = new Set();
  const changed = () => { write(KEYS.view, view); for (const listener of listeners) listener(view); };
  const clean = (where) => Object.fromEntries(Object.entries(where).filter(([, value]) => value));

  return {
    get: () => view,
    // Merges a change; `where` merges by key, a null value removes that key.
    set(change) {
      view = { ...view, ...change, where: clean({ ...view.where, ...(change.where ?? {}) }) };
      changed();
    },
    replace(next) { view = { ...DEFAULT_VIEW, ...next, where: clean({ ...(next.where ?? {}) }) }; changed(); },
    reset() { view = { ...DEFAULT_VIEW, where: {} }; changed(); },
    saved: () => saved,
    save(title) {
      const item = { id: `v${Date.now().toString(36)}`, title: String(title).trim().slice(0, 60) || 'Мой вид', view: JSON.parse(JSON.stringify(view)) };
      saved = [...saved, item];
      write(KEYS.saved, saved);
      return item;
    },
    open(id) { const item = saved.find((entry) => entry.id === id); if (item) this.replace(item.view); },
    remove(id) { saved = saved.filter((entry) => entry.id !== id); write(KEYS.saved, saved); },
    layout: () => layout,
    setLayout(next) { layout = next; write(KEYS.layout, next); for (const listener of listeners) listener(view); },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

// The device's store, shared by the panel and the centre.
export const viewStore = createViewStore();
