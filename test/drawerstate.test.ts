import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { panelMode } from '../web/drawer.js';

// The left panel's mode, kept on the device (design 2026-11-21).
test('panel mode: the stored value or conversations', () => {
  assert.equal(panelMode('contacts'), 'contacts');
  assert.equal(panelMode('tasks'), 'tasks');
  assert.equal(panelMode(null), 'conversations');
  assert.equal(panelMode('pulse'), 'conversations');
});
