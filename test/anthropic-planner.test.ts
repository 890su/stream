import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { anthropicPlanner } from '../src/tasks/anthropic.ts';
import { PLAN_SCHEMA } from '../src/tasks/planner.ts';

// The AI planner against a fake Messages API: request shape and parsing of the structured answer.
test('the planner sends one structured-output request and reads the tasks', async () => {
  let request: Record<string, any> = {};
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    request = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: request.model, stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify({ tasks: [{ task_id: null, title: 'Перезвонить Марку', responsible: 'me', executors: [], author: null, template: 'callback', due: null, message_ids: ['m1'], confidence: 0.9, note: null, filed: false, done: false, alternatives: [] }] }) }],
      usage: { input_tokens: 1200, output_tokens: 80 },
    }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const plan = anthropicPlanner('test-key', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    const output = await plan({ now: '2026-11-18T10:00:00Z', job_days: 14, projects: [], templates: [], open_tasks: [], closed_tasks: [], context: [], messages: [{ id: 'm1', time: '2026-11-18T09:59:00Z', source: 'me', from: 'владелец', party: 'me', text: 'перезвонить Марку', tags: [], in_tasks: [] }] });
    assert.equal(output.tasks[0]!.title, 'Перезвонить Марку');
    assert.deepEqual(output.usage, { input_tokens: 1200, output_tokens: 80 });
    assert.equal(request.model, 'claude-haiku-5-5');
    assert.equal(request.output_config.effort, 'low');
    assert.equal(request.output_config.format.type, 'json_schema');
    assert.ok(request.system[0].text.includes('#дневник'), 'templates are in the cached system prompt');
    assert.match(request.messages[0].content, /перезвонить Марку/);
  } finally { server.close(); }
});

test('the plan schema asks for roles, not an assignee', () => {
  const item = PLAN_SCHEMA.properties.tasks.items;
  for (const key of ['responsible', 'executors', 'author']) assert.ok((item.required as readonly string[]).includes(key), key);
  assert.ok(!('assignee' in item.properties) && !('person' in item.properties));
});
