// The AI's proposals (docs/plans/2026-11-21-ai-proposals-design.md): the triage no longer changes an existing task —
// it proposes, in a `triage_result`, to put messages into it (with its checklist items, «Готово?», project). Under each
// message of a waiting proposal the owner sees the task, the reason and the choices (question.js). A proposal is
// settled by the owner's `task_change` answering it (`proposal`), a `reject_proposal` correction, a message put into
// a task by hand, or a later result that withdraws it («Разобрать заново»). Pure — no DOM.
import { isOpen } from './taskfold.js';

const order = (a, b) => String(a.ts).localeCompare(String(b.ts));

// message id -> { id, task, alternatives, reason, messageIds, change, ts, processor } of the latest waiting proposal for it.
export function proposalsByMessage(events) {
  const answered = new Set();
  const linked = new Set(); // messages the owner put into a task himself
  for (const event of events) {
    // «✨ Разобрать заново» withdraws the proposals it replaces (src/tasks/retriage.ts).
    if (event.kind === 'triage_result') for (const id of event.payload?.data?.triage?.withdrawn ?? []) answered.add(id);
    if (event.author !== 'me') continue;
    const data = event.payload?.data ?? {};
    if (event.kind === 'correction' && data.op === 'reject_proposal' && data.proposal) answered.add(data.proposal);
    if (event.kind === 'task_change') {
      if (data.task?.proposal) answered.add(data.task.proposal);
      for (const message of data.task?.add ?? []) linked.add(message);
    }
  }
  const waiting = new Map();
  for (const event of events.filter((item) => item.kind === 'triage_result').sort(order)) {
    for (const proposal of event.payload?.data?.triage?.proposals ?? []) {
      if (answered.has(proposal.id) || proposal.message_ids.some((message) => linked.has(message))) continue;
      const item = { id: proposal.id, task: proposal.task_id, alternatives: proposal.alternatives ?? [], reason: proposal.reason ?? '',
        messageIds: proposal.message_ids, change: proposal.change, ts: event.ts,
        processor: event.payload.data.triage.processor ?? null };
      for (const message of proposal.message_ids) waiting.set(message, item);
    }
  }
  return waiting;
}

// What to ask under a message, or null: { proposal, reason, chosen, options: [{ id, title, open, current }], messageIds,
// change } — the proposed task first, then the known alternatives; «+ Новое дело» and «✕» are always there.
export function proposalOptions(view, proposal, tasksById) {
  if (!proposal) return null;
  const options = [proposal.task, ...proposal.alternatives].filter((id, index, all) => tasksById.has(id) && all.indexOf(id) === index)
    .map((id) => ({ id, title: tasksById.get(id).title, open: isOpen(tasksById.get(id)), current: false }));
  return { proposal: proposal.id, reason: proposal.reason, chosen: proposal.task, options, messageIds: proposal.messageIds, change: proposal.change };
}
