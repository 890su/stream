import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleConfig } from '../src/config.ts';
import { sourceTitle } from '../src/server/system.ts';

// Google Calendar, stage 1 (docs/plans/2026-11-20-google-calendar-design.md): settings are data.
test('the Google registry has the poll, the window, the calendars hidden by default and the Stream calendar name', () => {
  assert.equal(googleConfig.poll_s, 60);
  assert.equal(googleConfig.window_days, 14);
  assert.ok(googleConfig.hidden_by_default.some((pattern) => pattern.includes('holiday')));
  assert.equal(googleConfig.stream_calendar, 'Stream');
  assert.equal(googleConfig.reconnect_max_s, 120);
  assert.equal(sourceTitle('google_calendar'), 'Google Календарь');
});
