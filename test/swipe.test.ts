import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { revealOf, SWIPE_PX, peekSide, PEEK_EDGE } from '../web/swipe.js';

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

// With a mouse there is no swipe (owner, 2026-11-22): near the right edge of a tile the left-swipe action peeks out,
// near the left edge the right-swipe one; a click on it runs it.
test('mouse: the edge the pointer is near offers the action of that side', () => {
  const labels = { left: { icon: '⏱', text: 'Отложить' }, right: { icon: '☑', text: 'Задача' } };
  assert.equal(peekSide(395, 0, 400, labels), 'left', 'near the right edge');
  assert.equal(peekSide(400 - PEEK_EDGE, 0, 400, labels), 'left');
  assert.equal(peekSide(200, 0, 400, labels), null, 'the middle opens the conversation as before');
  assert.equal(peekSide(10, 0, 400, labels), 'right', 'near the left edge');
  assert.equal(peekSide(10, 0, 400, { left: labels.left }), null, 'no action on that side');
});
