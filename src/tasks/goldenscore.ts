// Golden conversation cases for the triage: their shape, validation and scoring of one planner output (pure).
import type { PlanMessage, PlanOutput, PlanTask } from './planner.ts';

export interface GoldenCase {
  id: string; records: PlanTask[]; context: PlanMessage[]; messages: PlanMessage[];
  expect: {
    create?: { message_ids: string[]; template?: string; done?: boolean }[];
    link?: { task_id: string; message_ids: string[] }[];
    nothing?: string[]; ask?: boolean;
  };
}
export interface GoldenScore { cases: number; missed: number; extra: number; duplicates: number; wrong_link: number; asked: number; linked_nothing: number; wrong_done: number }

// Parses JSON lines into cases; every id in `expect` must be a message of the case, every linked task a record.
export function parseCases(text: string, file: string): GoldenCase[] {
  const cases: GoldenCase[] = [];
  text.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    const where = `${file}:${index + 1}`;
    let item: GoldenCase;
    try { item = JSON.parse(line) as GoldenCase; } catch { throw new Error(`${where}: not JSON`); }
    if (!item.id || !Array.isArray(item.records) || !Array.isArray(item.context) || !Array.isArray(item.messages) || !item.expect) throw new Error(`${where}: incomplete case`);
    const messages = new Set(item.messages.map((message) => message.id));
    const records = new Set(item.records.map((record) => record.id));
    const known = (ids: string[]) => { for (const id of ids) if (!messages.has(id)) throw new Error(`${where}: unknown message ${id}`); };
    for (const entry of item.expect.create ?? []) known(entry.message_ids);
    for (const entry of item.expect.link ?? []) {
      known(entry.message_ids);
      if (!records.has(entry.task_id)) throw new Error(`${where}: unknown record ${entry.task_id}`);
    }
    known(item.expect.nothing ?? []);
    cases.push(item);
  });
  return cases;
}

export function scoreCase(expected: GoldenCase['expect'], output: PlanOutput): Omit<GoldenScore, 'cases'> {
  const covered = new Set(output.tasks.flatMap((task) => task.message_ids));
  const created = output.tasks.filter((task) => task.task_id === null);
  const nothing = new Set(expected.nothing ?? []);
  const linkOf = new Map<string, string>();
  for (const entry of expected.link ?? []) for (const id of entry.message_ids) linkOf.set(id, entry.task_id);

  let missed = 0;
  for (const entry of [...(expected.create ?? []), ...(expected.link ?? [])]) if (!entry.message_ids.some((id) => covered.has(id))) missed++;
  const extra = created.filter((task) => task.message_ids.length > 0 && task.message_ids.every((id) => nothing.has(id))).length;
  const duplicates = created.filter((task) => task.message_ids.some((id) => linkOf.has(id))).length;
  let wrongLink = 0;
  for (const task of output.tasks) {
    if (task.task_id === null) continue;
    if (task.message_ids.some((id) => linkOf.has(id) && linkOf.get(id) !== task.task_id)) wrongLink++;
  }
  // Informational: a record got only messages that should stay in the conversation; done differs from the expectation.
  const linkedNothing = output.tasks.filter((task) => task.task_id !== null && task.message_ids.length > 0 && task.message_ids.every((id) => nothing.has(id))).length;
  let wrongDone = 0;
  for (const entry of expected.create ?? []) {
    if (entry.done === undefined) continue;
    if (output.tasks.some((task) => task.message_ids.some((id) => entry.message_ids.includes(id)) && Boolean(task.done) !== entry.done)) wrongDone++;
  }
  const questions = (output as { questions?: unknown[] }).questions;
  return { missed, extra, duplicates, wrong_link: wrongLink, asked: Array.isArray(questions) && questions.length > 0 ? 1 : 0, linked_nothing: linkedNothing, wrong_done: wrongDone };
}

// A case whose planner call failed: every expected create and link counts as missed, so a flaky run never looks better.
export function failedCaseMissed(expected: GoldenCase['expect']): number {
  return (expected.create?.length ?? 0) + (expected.link?.length ?? 0);
}
