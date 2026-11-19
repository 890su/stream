import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { createBackStack } from '../web/backclose.js';

// The system back closes what is open on top instead of leaving the app. A fake history stands in for the browser.
function fakeWindow() {
  const entries: unknown[] = [null];
  const listeners: Array<() => void> = [];
  const win = {
    history: {
      get state() { return entries.at(-1); },
      pushState(state: unknown) { entries.push(state); },
      back() { entries.pop(); queueMicrotask(() => listeners.forEach((listener) => listener())); },
    },
    addEventListener(type: string, listener: () => void) { if (type === 'popstate') listeners.push(listener); },
  };
  const pressBack = () => win.history.back();
  return { win, entries, pressBack };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('back closes the top window, then the one under it, then leaves', async () => {
  const { win, entries, pressBack } = fakeWindow();
  const stack = createBackStack(win);
  const closed: string[] = [];
  stack.opened(() => closed.push('menu'));
  stack.opened(() => closed.push('dialog'));
  assert.equal(entries.length, 3);
  pressBack(); await settle();
  assert.deepEqual(closed, ['dialog']);
  pressBack(); await settle();
  assert.deepEqual(closed, ['dialog', 'menu']);
  assert.equal(entries.length, 1, 'the next back is the app\'s own');
});

test('closing by a button takes its history entry back without closing anything else', async () => {
  const { win, entries } = fakeWindow();
  const stack = createBackStack(win);
  const closed: string[] = [];
  stack.opened(() => closed.push('menu'));
  const done = stack.opened(() => closed.push('dialog'));
  done(); await settle();
  done(); await settle();
  assert.deepEqual(closed, [], 'the close callback is not called again, the menu stays');
  assert.equal(entries.length, 2);
});

test('entries left by an earlier load of the page do not confuse the count', async () => {
  const { win, pressBack } = fakeWindow();
  win.history.pushState({ overlay: 3, page: 'old' });
  const stack = createBackStack(win);
  const closed: string[] = [];
  stack.opened(() => closed.push('panel'));
  pressBack(); await settle();
  assert.deepEqual(closed, ['panel']);
});
