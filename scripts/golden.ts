// Golden run: sends every case of golden/conversations*.jsonl to the real AI planner and prints the score (spec «Эталонный набор»).
// Usage: pnpm golden [--only <id>]. Key: ANTHROPIC_API_KEY or the System screen key in DATA_DIR/secrets.json. Paths come from
// import.meta.url, so it also runs from a copy of the repo (e.g. /app/golden-run) with node_modules from the parent.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tasksConfig } from '../src/config.ts';
import { SecretStore } from '../src/secrets.ts';
import { anthropicPlanner } from '../src/tasks/anthropic.ts';
import { parseCases, scoreCase, type GoldenScore } from '../src/tasks/goldenscore.ts';

const OPEN = new Set(['inbox', 'todo', 'doing', 'waiting', 'review', 'deferred']);
const here = (path: string) => new URL(path, import.meta.url);

const key = process.env.ANTHROPIC_API_KEY || new SecretStore(resolve(process.env.DATA_DIR || 'data', 'secrets.json')).get('ANTHROPIC_API_KEY');
if (!key) {
  console.error('Нет ключа Anthropic: задайте ANTHROPIC_API_KEY или ключ на экране «Система» (DATA_DIR/secrets.json).');
  process.exit(1);
}

const flag = process.argv.indexOf('--only');
const only = flag > 0 ? process.argv[flag + 1] : null;
const cases = ['../golden/conversations.jsonl', '../golden/conversations.local.jsonl']
  .filter((path) => existsSync(here(path)))
  .flatMap((path) => parseCases(readFileSync(here(path), 'utf8'), path.split('/').pop()!))
  .filter((item) => !only || item.id === only);
if (!cases.length) { console.error('Нет случаев для прогона.'); process.exit(1); }

const planner = anthropicPlanner(key);
const total: GoldenScore = { cases: 0, missed: 0, extra: 0, duplicates: 0, wrong_link: 0, asked: 0 };
let inputTokens = 0, outputTokens = 0;
for (const item of cases) {
  const now = item.messages[item.messages.length - 1]?.time ?? new Date().toISOString();
  try {
    const output = await planner({
      now, job_days: tasksConfig.job_days, projects: [], counterparties: [], templates: tasksConfig.templates.filter((template) => !template.legacy),
      open_tasks: item.records.filter((record) => OPEN.has(record.status)), closed_tasks: item.records.filter((record) => !OPEN.has(record.status)),
      context: item.context, earlier_available: false, messages: item.messages,
    });
    const score = scoreCase(item.expect, output);
    total.cases++;
    for (const name of ['missed', 'extra', 'duplicates', 'wrong_link', 'asked'] as const) total[name] += score[name];
    inputTokens += output.usage?.input_tokens ?? 0;
    outputTokens += output.usage?.output_tokens ?? 0;
    console.log(`${item.id}: missed ${score.missed}, extra ${score.extra}, duplicates ${score.duplicates}, wrong_link ${score.wrong_link}, asked ${score.asked}`);
  } catch (error) {
    console.log(`${item.id}: ОШИБКА ${(error as Error).message}`);
  }
}
const price = tasksConfig.ai.price_per_mtok;
const cost = (inputTokens * price.input + outputTokens * price.output) / 1e6;
console.log(`Итого (${total.cases} из ${cases.length}): пропущено ${total.missed}, лишних ${total.extra}, дублей ${total.duplicates}, не та задача ${total.wrong_link}, вопросов ${total.asked}`);
console.log(`Токены: ${inputTokens} вход, ${outputTokens} выход; стоимость $${cost.toFixed(4)}`);
