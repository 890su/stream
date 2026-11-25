// The queue of conversations (CONCEPT.md §2.5, design 2026-11-25): «Новые» (unread), «Ждут решения» (the AI, an
// unfinished verdict, a task day) and «Прочитанные». `waiting` means any of those sections. The archive is only 🗄,
// a task of mine, or N quiet days (`queue.archive_read_days`, default 3, 0 = never). A reply without a task goes to
// «Прочитанные». A new incoming brings an archived conversation back to «Новые»; a message of mine brings it back to
// «Прочитанные». Unread is incoming after the later of my handling and the message time of the latest `read` mark
// (the correction's own time is activity for the quiet-days clock only). «Я» waits only for the AI. Pure — no DOM.
import { conversationOf, directionOf } from './conversations.js';
import { involvesMe, isOpen } from './taskfold.js';
import { whenOf } from './dayplan.js';
import { fromV21 } from './questions.js';

const time = (ts) => Date.parse(ts);
const later = (a, b) => (time(b) > time(a) ? b : a);
const DAY = 24 * 60 * 60 * 1000;
export const SECTION_TITLES = { new: 'Новые', decide: 'Ждут решения', read: 'Прочитанные' };
const SECTION_ORDER = { new: 0, decide: 1, read: 2 };
const NONE = { waiting: false, moment: null, since: null, pending: [], snoozedUntil: null, open: null, section: null, unread: 0 };

// The latest `read` mark, as the time of the message it points at. Deleted anchors count: call this before dropping them.
function readWatermark(views) {
  let at = -Infinity;
  let mark = -Infinity;
  for (const view of views) {
    if (!view.read || !view.readAt) continue;
    const readAt = time(view.readAt);
    if (readAt >= at) { at = readAt; mark = time(view.event.ts); }
  }
  return mark;
}

function latestReadAt(views) {
  let at = null;
  for (const view of views) if (view.read && view.readAt && (!at || time(view.readAt) > time(at))) at = view.readAt;
  return at;
}

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

// { waiting, section, unread, moment, since, pending, snoozedUntil, open }. `waiting` is any section.
// `conversation` needs key, views (with taskIds), tasks and group; `owner` — ownerLinked
// of all tasks; `questions` / `proposals` — the AI's waiting questions and proposals by message (questions.js,
// proposals.js); `tasksById` — all tasks: a proposal on a record closed or cancelled since holds nothing.
export function queueOf(conversation, { now = new Date(), config, owner = new Set(), questions = new Map(), proposals = new Map(), tasksById = new Map() }) {
  if (conversation.key.startsWith('task:')) return NONE;
  const own = conversation.key === 'me'; // my notes: nobody to answer, only the AI may wait for me
  const all = conversation.views;
  const seenUpTo = readWatermark(all);
  const views = all.filter((view) => !view.deleted).sort((a, b) => time(a.event.ts) - time(b.event.ts));
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
  const seen = Math.max(handled, seenUpTo);
  const pending = own ? [] : views.filter((view) => time(view.event.ts) > seen && time(view.event.ts) >= start && directionOf(view.event) === 'in'
    && !answeredCall(view) && !note(view) && meaningful(view) && matters(view));
  const unread = pending.length;
  const requeue = views.flatMap((view) => view.requeues ?? []).filter((ts) => time(ts) > handled).sort((a, b) => time(a) - time(b)).at(-1);
  const cleared = clearedAt(conversation, views);
  const back = requeue && time(requeue) > cleared ? requeue : null;
  const ai = { questions, proposals, tasksById };
  const reason = unread ? null : own ? aiWaitOf(conversation, views, ai, undefined, true) : unfinishedOf(conversation, views, start, handled, now, ai);

  let section = null;
  let moment = null;
  let since = null;
  if (unread > 0) {
    section = 'new';
    moment = pending[0].event.ts;
    since = moment;
  } else if (reason) {
    section = 'decide';
    moment = reason.moment;
    since = moment;
  } else if (!own) {
    const last = views.at(-1)?.event.ts ?? null;
    const activity = lastActivity(conversation, all);
    const days = config.queue.archive_read_days ?? 3;
    const quiet = days !== 0 && activity && now.getTime() - time(activity) >= days * DAY;
    const notCleared = (last && time(last) > cleared) || Boolean(back);
    if (notCleared && activity && time(activity) >= start && !quiet) {
      section = 'read';
      moment = activity;
      since = activity;
    }
  }
  if (section && requeue) moment = later(moment, requeue);
  const snooze = views.flatMap((view) => view.snoozes ?? []).filter((item) => time(item.at) > handled && !(back && time(back) > time(item.at)))
    .sort((a, b) => time(a.at) - time(b.at)).at(-1);
  if (snooze) {
    const after = pending.find((view) => time(view.event.ts) > time(snooze.at));
    if (after && section) moment = later(moment, after.event.ts);
    else if (!after && now.getTime() < time(snooze.until)) return { ...NONE, pending, unread, snoozedUntil: snooze.until };
    else if (section) moment = later(moment, snooze.until);
  }
  if (!section) return { ...NONE, pending, unread };
  return { waiting: true, moment, since, pending, snoozedUntil: null, open: reason?.reason ?? null, section, unread };
}

// Last activity of a read conversation: the latest message, the read correction's own time, and my acts.
function lastActivity(conversation, views) {
  const live = views.filter((view) => !view.deleted).sort((a, b) => time(a.event.ts) - time(b.event.ts));
  let at = live.at(-1)?.event.ts ?? null;
  const readAt = latestReadAt(views);
  if (readAt) at = at ? later(at, readAt) : readAt;
  for (const act of myActs({ ...conversation, views })) if (act) at = at ? later(at, act) : act;
  return at;
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
function aiWaitOf(conversation, views, { questions, proposals, tasksById = new Map() }, cleared = clearedAt(conversation, views), own = false) {
  const lastIn = views.filter((view) => directionOf(view.event) === 'in').at(-1);
  const at = (ts) => (lastIn ? lastIn.event.ts : ts);
  const live = (item) => !item.task || !tasksById.has(item.task) || isOpen(tasksById.get(item.task)); // a question has no task
  const fresh = (map) => views.map((view) => map.get(view.id)).find((item) => item && fromV21(item.processor) && time(item.ts) > cleared && live(item));
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

// The queue screen, top to bottom: «Новые», then «Ждут решения», then «Прочитанные». Inside a section the smallest
// moment is first — longest waiting on top; in «Прочитанные» that puts the freshest at the bottom.
export function queueList(list) {
  return list.filter((item) => item.queue?.waiting).sort((a, b) =>
    (SECTION_ORDER[a.queue.section] ?? 9) - (SECTION_ORDER[b.queue.section] ?? 9)
    || time(a.queue.moment) - time(b.queue.moment) || a.key.localeCompare(b.key));
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

// «Всё распределено ✓ · разобрано сегодня: N»: conversations with someone that wait for nothing and that I acted on
// today — my outgoing message, the archive mark, a snooze, an answer to the AI's question, a task of mine taking its
// messages. Someone else's message today is not my act.
export function handledToday(list, now = new Date()) {
  const today = now.toDateString();
  const onToday = (ts) => Boolean(ts) && new Date(ts).toDateString() === today;
  return archiveList(list).filter((conversation) => myActs(conversation).some(onToday)).length;
}

// The times of my acts on a conversation (handledToday).
function myActs(conversation) {
  const ids = new Set(conversation.views.map((view) => view.id));
  const acts = [];
  for (const view of conversation.views) {
    if (view.deleted) continue;
    if (directionOf(view.event) === 'out' && conversationOf(view.event) !== 'me') acts.push(view.event.ts);
    if (view.answered) acts.push(view.answeredAt);
    acts.push(view.decidedAt, ...(view.snoozes ?? []).map((item) => item.at));
  }
  for (const task of conversation.tasks) {
    for (const entry of task.history ?? []) if (entry.author === 'me' && (entry.change?.add ?? []).some((id) => ids.has(id))) acts.push(entry.ts);
  }
  return acts;
}

// The archive above the queue (owner, 2026-11-21): the conversations that wait for nothing (read, answered, archived,
// snoozed), each with `handledAt`, the last handled first — the screen shows it nearest the «Архив» divider. Own
// notes («Я · мои записи», a task's notes) are not conversations with anyone and stay out.
export function archiveList(list) {
  return list.filter((item) => !item.queue?.waiting && item.key !== 'me' && !item.key.startsWith('task:'))
    .map((item) => ({ ...item, handledAt: handledAt(item) }))
    .sort((a, b) => time(b.handledAt) - time(a.handledAt) || a.key.localeCompare(b.key));
}
