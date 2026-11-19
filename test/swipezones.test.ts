import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { zoneOf, objectTakes, swipeAction } from '../web/swipezones.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { pickTab } from '../web/taskcard.js';

// Screen swipes (owner's rule, 2026-11-19): columns 25 / 50 / 25; objects swipe only from the middle.
test('the screen is split 25 / 50 / 25', () => {
  assert.equal(zoneOf(80, 400), 'left');
  assert.equal(zoneOf(100, 400), 'middle');
  assert.equal(zoneOf(300, 400), 'middle');
  assert.equal(zoneOf(301, 400), 'right');
});

test('an object takes the swipe only in the middle; edges and the background move between screens', () => {
  assert.equal(objectTakes('middle', true), true);
  assert.equal(objectTakes('left', true), false);
  assert.equal(objectTakes('right', true), false);
  assert.equal(objectTakes('middle', false), false);
});

test('main: tabs in the middle, the left panel before the first and from the left edge, the right one after the last', () => {
  const main = (zone: string, dir: string, tab: number) => swipeAction({ surface: 'main', zone, dir, tab, tabs: 2 });
  assert.deepEqual(main('middle', 'next', 0), { tab: 1 });
  assert.deepEqual(main('middle', 'prev', 1), { tab: 0 });
  assert.equal(main('middle', 'prev', 0), 'drawer');
  assert.equal(main('middle', 'next', 1), 'right');
  assert.equal(main('left', 'prev', 1), 'drawer');
  assert.equal(main('right', 'next', 0), 'right');
  assert.deepEqual(main('left', 'next', 0), { tab: 1 }, 'from the left edge to the left: the next tab');
});

test('the card on a phone: its tabs; before the first one or from the left edge it closes', () => {
  const card = (zone: string, dir: string, tab: number) => swipeAction({ surface: 'details', zone, dir, tab, tabs: 4 });
  assert.deepEqual(card('middle', 'next', 0), { tab: 1 });
  assert.equal(card('middle', 'next', 3), null);
  assert.deepEqual(card('right', 'prev', 2), { tab: 1 });
  assert.equal(card('middle', 'prev', 0), 'close');
  assert.equal(card('left', 'prev', 2), 'close');
  assert.equal(swipeAction({ surface: 'details', zone: 'middle', dir: 'prev', tab: 0, tabs: 0 }), 'close', 'a card without tabs');
});

test('the card opens on the remembered tab if it has it, else on the first', () => {
  assert.equal(pickTab('people', ['talk', 'people', 'more', 'log']), 'people');
  assert.equal(pickTab('gone', ['talk', 'people']), 'talk');
  assert.equal(pickTab(null, ['talk']), 'talk');
});
