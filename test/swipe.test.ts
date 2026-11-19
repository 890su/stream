import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { revealOf, SWIPE_PX } from '../web/swipe.js';

// What a swipe reveals under the item (task card design §2): the side's icon and label, bright past the threshold.
const labels = { right: { icon: '✓', text: 'Готово' }, left: { icon: '🕒', text: 'Когда?' } };

test('a swipe shows the action of its side; past the threshold it is armed', () => {
  assert.deepEqual(revealOf(30, labels), { side: 'right', icon: '✓', text: 'Готово', armed: false });
  assert.deepEqual(revealOf(SWIPE_PX, labels), { side: 'right', icon: '✓', text: 'Готово', armed: true });
  assert.deepEqual(revealOf(-120, labels), { side: 'left', icon: '🕒', text: 'Когда?', armed: true });
});

test('nothing under a still item or a side without an action', () => {
  assert.equal(revealOf(0, labels), null);
  assert.equal(revealOf(40, { left: labels.left }), null);
  assert.equal(revealOf(-40, {}), null);
});
