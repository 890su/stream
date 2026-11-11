import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, event } from './helpers.ts';

const tagged = (tags: string[], tagging: Record<string, unknown>) => event({ payload: { text: 'заплатил 120 за кабель', tags, data: { tagging } } });
const base = { engine: 'local-v1', suggested: ['#закупка'], auto: ['#расход'], owner_on: ['#naserwis'], owner_off: ['#задача'] };

test('tag feedback is stored with the message and must agree with its tags', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const good = tagged(['#расход', '#naserwis'], base);
    const response = await post(good);
    assert.equal(response.status, 201);
    assert.deepEqual((await response.json()).payload.data.tagging, base);
    assert.equal((await post(tagged([], { ...base, auto: [], owner_on: [] }))).status, 201, 'all suggestions declined');

    for (const [name, tags, tagging] of [
      ['auto must be among tags', ['#naserwis'], base],
      ['owner_on must be among tags', ['#расход'], base],
      ['owner_off must not be among tags', ['#расход', '#naserwis', '#задача'], base],
      ['a tag is in one list only', ['#расход', '#naserwis'], { ...base, suggested: ['#расход'] }],
      ['engine is required', ['#расход', '#naserwis'], { ...base, engine: undefined }],
      ['no unknown fields', ['#расход', '#naserwis'], { ...base, extra: [] }],
      ['tags keep the pattern', ['#расход', '#naserwis'], { ...base, suggested: ['закупка'] }],
    ] as const) assert.equal((await post(tagged([...tags], JSON.parse(JSON.stringify(tagging))))).status, 400, name);
  } finally { await f.stop(); }
});

test('the client receives the tag dictionary from the registry', async () => {
  const f = await fixture();
  try {
    const config = await (await fetch(f.base + '/capture-config.json')).json();
    assert.equal('quick_tags' in config, false);
    assert.equal(config.tagging.engine, 'local-v1');
    assert.ok(config.tagging.auto_threshold > 0 && config.tagging.auto_threshold <= 1);
    assert.ok(config.tagging.tags.length > 0);
    for (const entry of config.tagging.tags) {
      assert.match(entry.tag, /^#[\p{L}0-9_-]+$/u);
      assert.ok(Array.isArray(entry.hints));
    }
  } finally { await f.stop(); }
});
