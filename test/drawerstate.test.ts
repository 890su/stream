import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { panelMode } from '../web/drawer.js';

// The left panel's mode, kept on the device (design 2026-11-21).
// The queue moved to the centre (owner, 2026-11-22): only «Задачи» and «Контакты» are left in the panel.
test('panel mode: the stored value or tasks', () => {
  assert.equal(panelMode('contacts'), 'contacts');
  assert.equal(panelMode('tasks'), 'tasks');
  assert.equal(panelMode(null), 'tasks');
  assert.equal(panelMode('conversations'), 'tasks', 'the old conversations mode');
});
