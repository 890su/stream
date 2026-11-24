// The queue of conversations (CONCEPT.md §2.5, docs/plans/2026-11-20-queue-and-task-screen-design.md): which
// conversations wait for the owner and since when. Only the owner's actions take a conversation out: a reply, a task
// made or chosen by the owner for its messages (an AI link is not one), the archive mark (`answered`), «⏱ Отложить»
// (`snooze`). A conversation with a day task of mine comes back on that day (owner, 2026-11-22: the archive hides
// it until the task day or a new incoming). «↧» after it was dealt with — a swipe on an archive tile — brings it back
// to the end of the queue and cancels a snooze (owner, 2026-11-22). Its place is its queue moment — the first waiting message, lifted by «↧» (`requeue`) or by the end of a
// snooze; a new message in a queued conversation does not move it. The archive means «read and sorted out»
// (design 2026-11-23, «Очередь — всё распределено»): while the AI waits for me — a question or an update proposal made
// by v21 or later (older ones keep the old rule), an unconfirmed record — my reply does not take the conversation out;
// 🗄 does, and my answer to the question handles the messages it asks about. My own notes («Я») wait only for the AI.
// Pure — no DOM.
import { conversationOf, directionOf } from './conversations.js';
import { involvesMe, isOpen } from './taskfold.js';
import { whenOf } from './dayplan.js';
import { fromV21 } from './questions.js';

const time = (ts) => Date.parse(ts);
const later = (a, b) => (time(b) > time(a) ? b : a);
const NONE = { waiting: false, moment: null, since: null, pending: [], snoozedUntil: null };

// Message ids the owner put into a task (a change authored `me` that adds them) and that are still there: those
// messages are handled. A later `remove` (as «Вернуть» on a task made from a tile does) undoes it.
export function ownerLinked(tasks) {
  const ids = new Set();
  for (const task of tasks) {
    const owned = new Set();
    for (const entry of task.history ?? []) {
      if (entry.author === 'me') for (const id of entry.change?.add ?? []) owned.add(id);
      for (const id of entry.change?.remove ?? []) owned.delete(id);
    }
    for (const id of owned) ids.add(id);
  }
  return ids;
}

// { waiting, moment, since (the first waiting message), pending (waiting messages), snoozedUntil, open (why it waits
// with no message waiting) }. `conversation` needs key, views (with taskIds), tasks and group; `owner` — ownerLinked
// of all tasks; `questions` / `proposals` — the AI's waiting questions and proposals by message (questions.js,
// proposals.js).
export function queueOf(conversation, { now = new Date(), config, owner = new Set(), questions = new Map(), proposals = new Map() }) {
  if (conversation.key.startsWith('task:')) return NONE;
  const own = conversation.key === 'me'; // my notes: nobody to answer, only the AI may wait for me
  const views = conversation.views.filter((view) => !view.deleted).sort((a, b) => time(a.event.ts) - time(b.event.ts));
  const byId = new Map(views.map((view) => [view.id, view]));
  const taskOf = new Map(conversation.tasks.map((task) => [task.id, task]));
  // An own note pulled into a chat or a number (a call description, a reply not sent) is neither an answer nor waiting.
  const note = (view) => conversationOf(view.event) === 'me';
  const answeredCall = (view) => view.event.kind === 'call' && view.event.payload?.data?.call?.direction === 'in';
  // Context-only messages and messages belonging only to filed or closed records («спасибо, работает» linked to a
  // finished job, done work) do not wait for an answer: only an open record that is not filed away makes them wait.
  const meaningful = (view) => {
    const tasks = (view.taskIds ?? []).map((id) => taskOf.get(id)).filter(Boolean);
    return tasks.length ? tasks.some((task) => !task.filed && isOpen(task)) : !view.conversationOnly;
  };
  // In a group, someone else's message matters to me only when it answers mine or is in a task where I have a role.
  const matters = (view) => {
    if (!conversation.group) return true;
    const parent = view.event.reply_to && byId.get(view.event.reply_to);
    if (parent && directionOf(parent.event) === 'out') return true;
    return (view.taskIds ?? []).some((id) => { const task = taskOf.get(id); return task && involvesMe(task); });
  };

  let handled = -Infinity;
  for (const view of views) {
    const mine = directionOf(view.event) === 'out' && !note(view);
    if (mine || view.answered || view.decided || owner.has(view.id) || answeredCall(view)) handled = Math.max(handled, time(view.event.ts));
  }
  // Messages from before the queue started (`queue.since`) wait for nobody: the history imported with the channels.
  const start = time(config.queue.since);
  const pending = own ? [] : views.filter((view) => time(view.event.ts) > handled && time(view.event.ts) >= start && directionOf(view.event) === 'in'
    && !answeredCall(view) && !note(view) && meaningful(view) && matters(view));
  const requeue = views.flatMap((view) => view.requeues ?? []).filter((ts) => time(ts) > handled).sort((a, b) => time(a) - time(b)).at(-1);
  // Back from the archive: a requeue later than every way it was dealt with (a reply, the archive mark, a task of mine).
  const back = requeue && time(requeue) > clearedAt(conversation, views) ? requeue : null;
  const ai = { questions, proposals };
  const open = pending.length ? null : own ? aiWaitOf(conversation, views, ai, undefined, true)
    : unfinishedOf(conversation, views, start, handled, now, ai) ?? (back ? { reason: 'из архива', moment: back } : null);
  if (!pending.length && !open) return NONE;

  let moment = pending[0]?.event.ts ?? open.moment;
  if (requeue) moment = later(moment, requeue);
  const snooze = views.flatMap((view) => view.snoozes ?? []).filter((item) => time(item.at) > handled && !(back && time(back) > time(item.at)))
    .sort((a, b) => time(a.at) - time(b.at)).at(-1);
  if (snooze) {
    const after = pending.find((view) => time(view.event.ts) > time(snooze.at));
    if (after) moment = later(moment, after.event.ts);
    else if (now.getTime() < time(snooze.until)) return { ...NONE, pending, snoozedUntil: snooze.until };
    else moment = later(moment, snooze.until);
  }
  return { waiting: true, moment, since: pending[0]?.event.ts ?? open.moment, pending, snoozedUntil: null, open: open?.reason ?? null };
}

// No message waits, yet the conversation is not over (owner, 2026-11-21): the AI waits for me (aiWaitOf), or the
// latest triage verdict says the other side still waits for me and no task covers it. My reply does not end it; the
// archive mark, a task of mine for its messages or a later verdict «finished» does. Or the day of a task of mine has
// come (its planned start, due date or reminder) and nothing was done in the conversation since that day began.
// → { reason, moment } or null.
function unfinishedOf(conversation, views, start, handled, now, ai) {
  const cleared = clearedAt(conversation, views);
  const waits = aiWaitOf(conversation, views, ai, cleared);
  if (waits) return waits;
  const lastIn = views.filter((view) => directionOf(view.event) === 'in').at(-1);
  const verdict = views.filter((view) => view.verdict).at(-1)?.verdict;
  if (verdict?.unfinished && time(verdict.ts) > cleared && time(verdict.ts) >= start) return { reason: verdict.unfinished, moment: lastIn?.event.ts ?? verdict.ts };
  return taskDayOf(conversation, Math.max(cleared, handled), now);
}

// The AI waits for my answer about this conversation's messages (design 2026-11-23): a question, an update proposal,
// an unconfirmed record — each made after the conversation was last cleared (🗄, a task of mine); still answerable
// after that, it no longer holds the conversation. Done work (a closed record) waits for nothing. Questions and
// proposals hold only when made by v21 or later (`fromV21`): an old unanswered v15–v20 proposal keeps the old rule —
// my reply takes the conversation out. An unconfirmed record held it before v21 too (v18), so in a chat any does; in
// «Я» only a v21 one (older notes are in their task's conversation). → { reason, moment }.
function aiWaitOf(conversation, views, { questions, proposals }, cleared = clearedAt(conversation, views), own = false) {
  const lastIn = views.filter((view) => directionOf(view.event) === 'in').at(-1);
  const at = (ts) => (lastIn ? lastIn.event.ts : ts);
  const fresh = (map) => views.map((view) => map.get(view.id)).find((item) => item && fromV21(item.processor) && time(item.ts) > cleared);
  const question = fresh(questions);
  if (question) return { reason: 'ИИ спрашивает', moment: at(question.ts) };
  const proposal = fresh(proposals);
  if (proposal) return { reason: 'ИИ предлагает правку', moment: at(proposal.ts) };
  const offer = conversation.tasks.find((task) => task.unconfirmed && isOpen(task) && time(task.createdAt) > cleared && (!own || fromV21(task.processor)));
  if (offer) return { reason: 'ИИ предлагает задачу', moment: at(offer.createdAt) };
  return null;
}

// When the owner last took the conversation out by a mark: the archive mark, a task of mine taking its messages.
function clearedAt(conversation, views) {
  const ids = new Set(views.map((view) => view.id));
  let cleared = -Infinity;
  for (const view of views) if (view.answered && view.answeredAt) cleared = Math.max(cleared, time(view.answeredAt));
  for (const task of conversation.tasks) {
    for (const entry of task.history ?? []) if (entry.author === 'me' && (entry.change?.add ?? []).some((id) => ids.has(id))) cleared = Math.max(cleared, time(entry.ts));
  }
  return cleared;
}

// The earliest day task of mine whose day has begun after the conversation was last dealt with.
function taskDayOf(conversation, since, now) {
  const today = dayStart(now);
  let found = null;
  for (const task of conversation.tasks) {
    if (!isOpen(task) || task.filed || task.unconfirmed || !involvesMe(task)) continue;
    const key = whenOf(task)?.key;
    if (!key) continue;
    const [year, month, day] = key.split('-').map(Number);
    const begins = new Date(year, month - 1, day).getTime();
    if (begins > now.getTime() || begins <= since) continue;
    if (!found || begins < found.begins) found = { begins, task };
  }
  if (!found) return null;
  const label = found.begins >= today ? 'сегодня' : 'просрочено';
  return { reason: `${label}: ${found.task.title}`, moment: new Date(found.begins).toISOString() };
}
const dayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// The waiting conversations as the screen shows them top to bottom: the longest waiting first, the newest moment
// last (owner, 2026-11-21: the most important on top).
export function queueList(list) {
  return list.filter((item) => item.queue?.waiting).sort((a, b) => time(a.queue.moment) - time(b.queue.moment) || a.key.localeCompare(b.key));
}

// When the owner last dealt with a conversation: its latest message (a reply is one), the archive mark, a snooze, an
// answer to the AI's question, a task of theirs taking its messages — whichever is latest.
export function handledAt(conversation) {
  const ids = new Set(conversation.views.map((view) => view.id));
  let at = conversation.last;
  for (const view of conversation.views) {
    if (view.answered && view.answeredAt) at = later(at, view.answeredAt);
    if (view.decidedAt) at = later(at, view.decidedAt);
    for (const item of view.snoozes ?? []) at = later(at, item.at);
  }
  for (const task of conversation.tasks) {
    for (const entry of task.history ?? []) if (entry.author === 'me' && (entry.change?.add ?? []).some((id) => ids.has(id))) at = later(at, entry.ts);
  }
  return at;
}

// «Всё распределено ✓ · разобрано сегодня: N»: conversations with someone that wait for nothing and were last dealt
// with today (handledAt — a reply, the archive mark, a snooze, a task of mine; a new incoming that was answered counts).
export function handledToday(list, now = new Date()) {
  const today = now.toDateString();
  return archiveList(list).filter((item) => new Date(item.handledAt).toDateString() === today).length;
}

// The archive above the queue (owner, 2026-11-21): the conversations that wait for nothing (read, answered, archived,
// snoozed), each with `handledAt`, the last handled first — the screen shows it nearest the «Архив» divider. Own
// notes («Я · мои записи», a task's notes) are not conversations with anyone and stay out.
export function archiveList(list) {
  return list.filter((item) => !item.queue?.waiting && item.key !== 'me' && !item.key.startsWith('task:'))
    .map((item) => ({ ...item, handledAt: handledAt(item) }))
    .sort((a, b) => time(b.handledAt) - time(a.handledAt) || a.key.localeCompare(b.key));
}
