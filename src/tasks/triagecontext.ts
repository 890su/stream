// Which records the triage shows the AI: all of the interlocutor's (open, and closed within reopen_days) plus a few
// recent open ones of others. Before, the global top 40 pushed an old open task of the very client out of context.
import { isOpen, type Task } from './fold.ts';

export interface Interlocutor { key: string; parties: Set<string>; counterparties: Set<string> }

export function interlocutorRecords(tasks: Task[], who: Interlocutor, keysOf: (task: Task) => Set<string>,
  { now, reopenDays, others }: { now: number; reopenDays: number; others: number }): { open: Task[]; closed: Task[] } {
  const roleParties = (task: Task) => {
    const { author, responsible, executors, controller, watchers, members } = task.roles;
    return [author, responsible, controller, ...executors, ...watchers, ...members];
  };
  // Cheap checks first: `keysOf` may be lazy (it looks up the record's messages) and runs only for the rest.
  const theirs = (task: Task) => roleParties(task).some((party) => party !== null && who.parties.has(party))
    || (task.counterparty != null && who.counterparties.has(task.counterparty))
    || keysOf(task).has(who.key);
  const recent = (a: Task, b: Task) => b.updated_at.localeCompare(a.updated_at);
  const own = tasks.filter(theirs);
  const ownIds = new Set(own.map((task) => task.id));
  const since = new Date(now - reopenDays * 86_400_000).toISOString();
  return {
    open: [...own.filter(isOpen).sort(recent),
      ...tasks.filter((task) => isOpen(task) && !ownIds.has(task.id)).sort(recent).slice(0, others)],
    closed: own.filter((task) => !isOpen(task) && task.updated_at >= since).sort(recent),
  };
}
