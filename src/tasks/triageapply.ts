// How the triage applies one planned outcome (triage-ai-v21, docs/plans/2026-11-23-conversation-records-design.md):
// messages that continue an open record are linked to it at once by the system; what would change its content (items,
// title, due, «done» with a report, project, counterparty) is only proposed. A closed record is never reopened: a
// thank-you is only linked, a new request (the AI's `repeat_of`) is a new record that points to it. Work requested and done inside the
// conversation is a done record with its report draft. Pure — the caller writes the events.
import type { TriageNewTasks } from '../ownersettings.ts';
import type { Counterparty } from '../contacts/fold.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import { tasksConfig } from '../config.ts';
import { nameId } from '../ids.ts';
import type { Task } from './fold.ts';
import type { PlanMessage, PlannedQuestion, PlannedTask } from './planner.ts';
import { defaultController, isParty } from './parties.ts';
import type { Project } from './projects.ts';
import { counterpartyChange } from './counterparty.ts';

export type Applied =
  | { kind: 'link'; task_id: string; add: string[] } // system task_change, applied
  | { kind: 'proposal'; task_id: string; message_ids: string[]; change: Record<string, unknown> } // in triage_result.proposals
  | { kind: 'create'; task_id: string; change: Record<string, unknown> }; // incl. done work and repeats

export interface ApplyContext {
  index: number; batchKey: string; // which outcome of which batch: ids of what it makes
  batchIds: Set<string>; conversationOnly: Set<string>;
  open: Map<string, Task>; closed: Map<string, Task>; // the records the planner was shown
  removed: Map<string, Set<string>>; // task id → messages the owner took out of it: never linked back
  unlinked?: Map<string, Set<string>>; // links «Разобрать заново» withdraws: not counted as in the task
  projects: Project[]; counterparties: Counterparty[]; filedTemplates: Set<string>; newTasks: TriageNewTasks;
  roles: (planned: PlannedTask, add: string[]) => Record<string, unknown>;
}

export interface TriageQuestion { id: string; message_ids: string[]; text: string; options: PlannedQuestion['options'] }

// Checklist items and a new title from the planner (CONCEPT.md §2.8): one-line items not already in the task;
// a rename only for an existing task the owner has not named.
export function checklistChange(taskId: string, planned: PlannedTask, task?: Task): Record<string, unknown> {
  const known = new Set((task?.items ?? []).map((item) => item.text.trim().toLowerCase()));
  const items_add: { id: string; text: string }[] = [];
  for (const raw of planned.items ?? []) {
    const text = String(raw).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text || known.has(text.toLowerCase())) continue;
    known.add(text.toLowerCase());
    items_add.push({ id: nameId(`item|${taskId}|${text}`), text });
  }
  const rename = planned.rename?.trim().slice(0, 200);
  const title = task && rename && !task.owner_titled && rename !== task.title ? { title: rename } : {};
  return { ...(items_add.length ? { items_add } : {}), ...title };
}

// The project of a planned task (CONCEPT.md §2.11): the planner's project if it is active, a section only of that
// project. A task that already has a project keeps it; filed outcomes get none. When unsure — `project_options`.
export function projectChange(planned: PlannedTask, task: Task | undefined, projects: Project[]): Record<string, unknown> {
  if (planned.filed || task?.project) return {};
  const byId = new Map(projects.map((project) => [project.id, project]));
  const options = [...new Set(planned.project_options ?? [])].filter((id) => byId.has(id)).slice(0, 3);
  // Only the planner's choice by the project's scope: the source alone puts nothing into a project (owner, 2026-11-20).
  const chosen = (planned.project && byId.get(planned.project)) || null;
  if (!chosen) return options.length ? { project_options: options } : {};
  const section = chosen.sections.find((item) => item.id === planned.section);
  return { project: chosen.id, section: section?.id ?? null };
}

// A report draft from what the conversation says was done (task manager spec §11): only valid fields — a known
// currency, sums and minutes not below zero, the result line up to 500 characters. A reported task keeps its report.
export function reportDraft(planned: PlannedTask, task?: Task): { report?: Record<string, unknown> } {
  const draft = planned.report;
  if (!draft || task?.report) return {};
  const report: Record<string, unknown> = {};
  const note = draft.note?.trim();
  if (note) report.note = note.slice(0, 500);
  for (const key of ['duration_min', 'cost', 'expenses'] as const) {
    const value = draft[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) report[key] = key === 'duration_min' ? Math.round(value) : value;
  }
  if ((report.cost !== undefined || report.expenses !== undefined) && draft.currency && tasksConfig.currencies.includes(draft.currency)) report.currency = draft.currency;
  return Object.keys(report).length ? { report } : {};
}

// task id → messages the owner took out of it (an owner `task_change` with `remove`): the triage never links them back.
export function ownerRemoved(events: JournalEvent[]): Map<string, Set<string>> {
  const removed = new Map<string, Set<string>>();
  for (const event of events) {
    const change = event.payload.data?.task as { remove?: string[] } | undefined;
    if (event.kind !== 'task_change' || event.author !== 'me' || !change?.remove?.length) continue;
    const id = event.payload.ref!.id;
    removed.set(id, new Set([...(removed.get(id) ?? []), ...change.remove]));
  }
  return removed;
}

// Roles of a new record (P14) from the planner's parties: the owner, AI, the system and everyone who wrote in the
// batch or its context; a `name:` party is a person without an account and passes. Anything else is made up and dropped.
export function rolesFor(messages: Pick<PlanMessage, 'id' | 'party'>[]): (planned: PlannedTask, add: string[]) => Record<string, unknown> {
  const allowed = new Set(['me', 'ai', 'system', ...messages.map((message) => message.party)]);
  const valid = (party: unknown): party is string => isParty(party) && (allowed.has(party) || party.startsWith('name:'));
  const partyOfMessage = new Map(messages.map((message) => [message.id, message.party]));
  return (planned, add) => {
    const template = tasksConfig.templates.find((item) => item.name === planned.template);
    const executors = template?.filed ? [template.assignee] : [...new Set(planned.executors.filter(valid))];
    const responsible = template?.filed ? 'me' : valid(planned.responsible) ? planned.responsible : 'me';
    const author = valid(planned.author) ? planned.author : partyOfMessage.get(add[0]!);
    // Work I hand to others, or ask someone else to answer for, is under my control («На контроле»).
    const controller = defaultController({ author, responsible, executors });
    return { ...(author ? { author } : {}), responsible, executors, ...(controller ? { controller } : {}) };
  };
}

const isFiledRecord = (task: Task, filedTemplates: Set<string>) => task.filed || filedTemplates.has(task.template ?? '');

// One planned outcome → what to write. An unknown task_id is a new record.
export function applyPlanned(planned: PlannedTask, ctx: ApplyContext): Applied[] {
  const ids = [...new Set(planned.message_ids)].filter((id) => ctx.batchIds.has(id) && !ctx.conversationOnly.has(id));
  if (!ids.length) return [];
  const open = planned.task_id ? ctx.open.get(planned.task_id) : undefined;
  const closed = planned.task_id ? ctx.closed.get(planned.task_id) : undefined;
  if (open) return continueOpen(open, planned, ids, ctx);
  if (closed && isFiledRecord(closed, ctx.filedTemplates)) {
    // A filed note gets its filed message; work asked about it is a record of its own, the note stays as it was.
    return planned.filed ? linkOnly(closed, ids, ctx) : create(planned, ids, null, ctx);
  }
  if (closed) {
    // A new request about it is a new record only when the AI says so (`repeat_of`); anything else — «спасибо,
    // работает», even with «done», items or a due — is only a link: a closed record gets no content changes.
    return planned.repeat_of === closed.id ? create(planned, ids, closed.id, ctx) : linkOnly(closed, ids, ctx);
  }
  const repeated = planned.repeat_of ? ctx.closed.get(planned.repeat_of) : undefined;
  return create(planned, ids, repeated && !isFiledRecord(repeated, ctx.filedTemplates) ? repeated.id : null, ctx);
}

// Messages of the outcome that may go into `task`: not taken out of it by the owner, and those not in it yet.
function linkable(task: Task, ids: string[], ctx: ApplyContext): { mine: string[]; add: string[] } {
  const removed = ctx.removed.get(task.id) ?? new Set<string>();
  const unlinked = ctx.unlinked?.get(task.id) ?? new Set<string>();
  const inTask = new Set(task.messages.filter((id) => !unlinked.has(id)));
  const mine = ids.filter((id) => !removed.has(id));
  return { mine, add: mine.filter((id) => !inTask.has(id)) };
}

function linkOnly(task: Task, ids: string[], ctx: ApplyContext): Applied[] {
  const { add } = linkable(task, ids, ctx);
  return add.length ? [{ kind: 'link', task_id: task.id, add }] : [];
}

function continueOpen(task: Task, planned: PlannedTask, ids: string[], ctx: ApplyContext): Applied[] {
  const { mine, add } = linkable(task, ids, ctx);
  if (!mine.length) return [];
  const done = planned.done && !planned.filed && task.proposed !== 'done' ? { proposed: 'done', ...reportDraft(planned, task) } : {};
  const change = { ...checklistChange(task.id, planned, task), ...(planned.due && planned.due !== task.due ? { due: planned.due } : {}), ...done,
    ...projectChange(planned, task, ctx.projects), ...counterpartyChange(planned, task, ctx.counterparties) };
  return [
    ...(add.length ? [{ kind: 'link' as const, task_id: task.id, add }] : []),
    ...(Object.keys(change).length ? [{ kind: 'proposal' as const, task_id: task.id, message_ids: mine, change }] : []),
  ];
}

function create(planned: PlannedTask, add: string[], repeatOf: string | null, ctx: ApplyContext): Applied[] {
  const taskId = nameId(`task|${ctx.batchKey}|${ctx.index}`);
  const confidence = Math.max(0, Math.min(1, planned.confidence));
  const done = planned.done && !planned.filed; // work asked and done inside the conversation
  const status = confidence < tasksConfig.low_confidence ? 'inbox' : planned.filed || done ? 'done' : 'todo';
  const reason = planned.reason?.trim().slice(0, 500);
  const change: Record<string, unknown> = {
    op: 'create', title: planned.title.trim().slice(0, 200) || 'Без названия', roles: ctx.roles(planned, add), status, add, confidence,
    processor: tasksConfig.ai.processor,
    ...(done ? { ...(status === 'done' ? {} : { proposed: 'done' }), ...reportDraft(planned) } : {}),
    ...checklistChange(taskId, planned), ...projectChange(planned, undefined, ctx.projects), ...counterpartyChange(planned, undefined, ctx.counterparties),
    // v16: a new task waits for the owner unless he chose «ИИ создаёт сразу»; filed notes never wait.
    ...(ctx.newTasks === 'unconfirmed' && !planned.filed ? { unconfirmed: true } : {}),
    ...(planned.template ? { template: planned.template } : {}), ...(planned.due ? { due: planned.due } : {}),
    ...(planned.note ? { note: planned.note } : {}), ...(reason ? { reason } : {}), ...(repeatOf ? { repeat_of: repeatOf } : {}),
  };
  return [{ kind: 'create', task_id: taskId, change }];
}

// The AI's questions (v21 `ask`): only about messages of the batch, options that name a known record, a new one or
// nothing — up to three; a question left with fewer than two options is dropped.
export function questionsOf(questions: PlannedQuestion[] | undefined, { batchKey, batchIds, known }: { batchKey: string; batchIds: Set<string>; known: Set<string> }): TriageQuestion[] {
  const templates = new Set(tasksConfig.templates.map((template) => template.name));
  const result: TriageQuestion[] = [];
  (questions ?? []).forEach((question, index) => {
    const message_ids = [...new Set(question.message_ids ?? [])].filter((id) => batchIds.has(id));
    const text = String(question.text ?? '').trim().slice(0, 300);
    const options = (question.options ?? []).map((option) => ({
      label: String(option.label ?? '').trim().slice(0, 120), task_id: option.task_id || null, title: option.title?.trim().slice(0, 200) || null,
      template: option.template && templates.has(option.template) ? option.template : null, nothing: Boolean(option.nothing),
    })).filter((option) => option.label && (option.task_id ? known.has(option.task_id) : option.nothing || option.title)).slice(0, 3);
    if (message_ids.length && text && options.length >= 2) result.push({ id: nameId(`question|${batchKey}|${index}`), message_ids, text, options });
  });
  return result;
}
