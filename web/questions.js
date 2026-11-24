// The AI's questions (triage-ai-v21 `ask`, docs/plans/2026-11-23-conversation-records-design.md «Очередь — всё
// распределено»): the triage was unsure — is it a task or nothing, a new record or a continuation of «…» — and wrote
// a question with 2–3 options into its `triage_result`. A question waits for the owner until his `answer_question`
// correction (an option or words) or a later result that withdraws it («✨ Разобрать заново»). The archive mark does
// not answer it: it only lets the conversation leave the queue (queue.js). Pure — no DOM.

const order = (a, b) => String(a.ts).localeCompare(String(b.ts));

// message id -> { id, text, options, messageIds, ts } of the latest waiting question about it.
export function questionsByMessage(events) {
  const answered = new Set();
  for (const event of events) {
    if (event.kind === 'triage_result') for (const id of event.payload?.data?.triage?.withdrawn ?? []) answered.add(id);
    const data = event.payload?.data ?? {};
    if (event.author === 'me' && event.kind === 'correction' && data.op === 'answer_question' && data.question) answered.add(data.question);
  }
  const waiting = new Map();
  for (const event of events.filter((item) => item.kind === 'triage_result').sort(order)) {
    for (const question of event.payload?.data?.triage?.questions ?? []) {
      if (answered.has(question.id)) continue;
      const item = { id: question.id, text: question.text, options: question.options ?? [], messageIds: question.message_ids, ts: event.ts };
      for (const message of question.message_ids) waiting.set(message, item);
    }
  }
  return waiting;
}
