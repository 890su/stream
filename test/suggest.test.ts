import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { suggestTags, tagStats, typedTags } from '../web/suggest.js';

const dictionary = JSON.parse(readFileSync(new URL('../registry/tags.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-11-11T12:00:00Z');
const view = (tags: string[], tagging?: object, daysAgo = 1) => ({
  tags, event: { ts: new Date(now - daysAgo * 86400000).toISOString(), payload: tagging ? { data: { tagging } } : {} },
});
const history = (tag: string, times: number, tagging?: object) => Array.from({ length: times }, () => view([tag], tagging));
const top = (result: Array<{ tag: string }>) => result.map((item) => item.tag);

test('with an empty draft the most used tags come first and nothing switches on by itself', () => {
  const stats = tagStats([...history('#расход', 6), ...history('#stream', 3), ...history('#идея', 1)], now);
  const result = suggestTags({ text: '', stats, dictionary });
  assert.deepEqual(top(result).slice(0, 3), ['#расход', '#stream', '#идея']);
  assert.ok(result.every((item: { auto: boolean }) => !item.auto));
});

test('typing moves matching tags up; a strong match with a habit switches on by itself', () => {
  const fresh = suggestTags({ text: 'заплатил 120 злотых за кабель', stats: new Map(), dictionary });
  assert.equal(fresh[0].tag, '#расход');
  assert.equal(fresh[0].auto, false, 'two hints without history are not enough');
  const used = tagStats(history('#расход', 10), now);
  const strong = suggestTags({ text: 'заплатил 120 злотых, чек в машине', stats: used, dictionary });
  assert.equal(strong[0].tag, '#расход');
  assert.equal(strong[0].auto, true);
});

test('tags the owner switched off before lose trust and stop switching on', () => {
  const kept = tagStats(history('#расход', 10, { engine: 'local-v1', suggested: [], auto: ['#расход'], owner_on: [], owner_off: [] }), now);
  const rejected = tagStats([...history('#расход', 10), ...history('#x', 6, { engine: 'local-v1', suggested: [], auto: [], owner_on: [], owner_off: ['#расход'] })], now);
  const text = 'заплатил 120 злотых, чек в машине';
  assert.equal(suggestTags({ text, stats: kept, dictionary })[0].auto, true);
  const after = suggestTags({ text, stats: rejected, dictionary }).find((item: { tag: string }) => item.tag === '#расход');
  assert.equal(after.auto, false);
});

test('tags created by the owner are suggested from history; old use counts less', () => {
  const stats = tagStats([...history('#stream', 2), view(['#старое'], undefined, 90), view(['#старое'], undefined, 90)], now);
  assert.ok(stats.get('#stream').uses > stats.get('#старое').uses);
  assert.ok(top(suggestTags({ text: 'по проекту', stats, dictionary })).includes('#stream'));
});

test('hashtags typed in the text are recognised, case-insensitively and once', () => {
  assert.deepEqual(typedTags('купить кабель #Закупка и ещё #закупка, #naserwis!'), ['#закупка', '#naserwis']);
  assert.deepEqual(typedTags('без меток'), []);
});
