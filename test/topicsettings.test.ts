import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { parseTopicSettings } from '../web/topicsettings.js';

// The «Темы» section of the System screen (topics design 2026-11-23): two whole numbers of days, 1–365.
test('parseTopicSettings reads two integers; anything else is null', () => {
  assert.deepEqual(parseTopicSettings({ topic_days: '14', archive_days: ' 3 ' }), { topic_days: 14, archive_days: 3 });
  assert.equal(parseTopicSettings({ topic_days: '0', archive_days: '3' }), null);
  assert.equal(parseTopicSettings({ topic_days: '14', archive_days: '2.5' }), null);
  assert.equal(parseTopicSettings({ topic_days: '', archive_days: '3' }), null);
});
