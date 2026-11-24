// «✨ Сверить с перепиской» in the task card (docs/plans/2026-11-23-conversation-records-design.md «✨ на записи»): the
// server's recheck (src/tasks/recheck.ts) writes its proposals into a `triage_result` with `recheck: <task id>`; here
// they are listed in that record's card with ✓ ✕. ✓ writes the change and every `also` (proposals.js `acceptEvents`,
// the same path as under a message), ✕ is a `reject_proposal`. Pure helpers first, then the list and the request.
import { settledProposals, acceptEvents } from './proposals.js';
import { makeCorrection, nameUuid } from './shared.js';

const order = (a, b) => String(a.ts).localeCompare(String(b.ts));

// task id -> [{ id, kind, task, messageIds, reason, change, also, ts }] of the recheck proposals still waiting.
export function recheckProposals(events) {
  const { answered } = settledProposals(events);
  const waiting = new Map();
  for (const event of events.filter((item) => item.kind === 'triage_result').sort(order)) {
    const triage = event.payload?.data?.triage;
    if (!triage?.recheck) continue;
    for (const proposal of triage.proposals ?? []) {
      if (answered.has(proposal.id)) continue;
      const item = { id: proposal.id, kind: proposal.kind ?? 'update', task: proposal.task_id, messageIds: proposal.message_ids ?? [], reason: proposal.reason ?? '',
        change: proposal.change ?? {}, also: proposal.also ?? [], ts: event.ts };
      waiting.set(item.task, [...(waiting.get(item.task) ?? []), item]);
    }
  }
  return waiting;
}

const titleOf = (id, tasksById) => tasksById.get(id)?.title ?? 'запись';
const day = (value) => { const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? ''); return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value); };

// One line of what the proposal does.
export function recheckLabel(item, tasksById) {
  const { change } = item;
  const count = item.messageIds.length || (change.add ?? change.remove ?? []).length;
  switch (item.kind) {
    case 'add': return `Подтянуть сообщения: ${count}`;
    case 'remove': {
      const to = item.also.find((other) => other.change?.add)?.task_id;
      return `Убрать сообщения: ${count}${to ? ` → «${titleOf(to, tasksById)}»` : ' (другое дело)'}`;
    }
    case 'rename': return `Название: «${change.title}»`;
    case 'due': return change.due ? `Срок: ${day(change.due)}` : 'Срок: убрать';
    case 'items': return `Пункт: ${change.items_add?.map((entry) => entry.text).join(', ')}`;
    case 'status': return `Похоже, сделано${change.report?.note ? `: ${change.report.note}` : ''}`;
    case 'merge': return `Склеить с «${titleOf(item.also[0]?.task_id, tasksById)}»`;
    default: return 'Правка записи';
  }
}

// ✕: a `reject_proposal` correction on the proposal's first message, else on a message of the record (`fallback`);
// a stable id, so a double tap is one correction.
export function rejectEvent(item, fallback) {
  return makeCorrection(item.messageIds[0] ?? fallback, 'reject_proposal', { proposal: item.id, id: nameUuid(`reject|${item.id}`) });
}

// The toast after the request: the count, «Расхождений нет», or the server's reason.
export function recheckToast(status, body) {
  if (status === 200) return body?.proposals ? `Предложений: ${body.proposals}` : 'Расхождений нет';
  return body?.error ? String(body.error).replace(/^\d{3} /, '') : `Не удалось сверить (${status})`; // the server's HttpError starts with its status
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The list in the card, or null when nothing waits. ctx: { proposals, tasksById, accept(item), reject(item) }.
export function recheckList(ctx) {
  if (!ctx.proposals?.length) return null;
  const box = element('div', 'recheck-list');
  box.append(element('p', 'recheck-head', `✨ ИИ предлагает по переписке: ${ctx.proposals.length}`));
  for (const item of ctx.proposals) {
    const row = element('div', 'recheck-row');
    const text = element('div', 'recheck-text');
    text.append(element('span', 'recheck-label', recheckLabel(item, ctx.tasksById)));
    if (item.reason) text.append(element('span', 'case-question-reason', `Почему: ${item.reason}`));
    const yes = element('button', 'chip suggest recheck-yes', '✓');
    yes.type = 'button';
    yes.setAttribute('aria-label', 'Принять');
    const no = element('button', 'chip suggest muted recheck-no', '✕');
    no.type = 'button';
    no.setAttribute('aria-label', 'Отклонить');
    yes.onclick = () => { yes.disabled = no.disabled = true; ctx.accept(item); };
    no.onclick = () => { yes.disabled = no.disabled = true; ctx.reject(item); };
    row.append(text, yes, no);
    box.append(row);
  }
  return box;
}

// The request (POST /api/tasks/:id/recheck) → the toast's text.
export async function runRecheck(taskId, { token, fetcher = fetch }) {
  try {
    const response = await fetcher(`/api/tasks/${taskId}/recheck`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    return recheckToast(response.status, await response.json().catch(() => ({})));
  } catch (error) { return error.message; }
}
