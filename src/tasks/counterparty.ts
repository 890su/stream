// The counterparty of a planned task (contacts design §6): the planner's choice when it is a known active
// counterparty and the task has none yet; otherwise the options (known and active, up to three) and the planner's
// name for a new one. A task that has a counterparty — set by the owner or earlier — keeps it.
import type { PlannedTask } from './planner.ts';
import type { Task } from './fold.ts';
import type { Counterparty } from '../contacts/fold.ts';

export function counterpartyChange(planned: PlannedTask, task: Task | undefined, counterparties: Counterparty[]): Record<string, unknown> {
  if (planned.filed || (task as { counterparty?: string | null } | undefined)?.counterparty) return {};
  const active = new Set(counterparties.filter((item) => item.status === 'active').map((item) => item.id));
  if (planned.counterparty && active.has(planned.counterparty)) return { counterparty: planned.counterparty };
  const options = [...new Set(planned.counterparty_options ?? [])].filter((id) => active.has(id)).slice(0, 3);
  const hint = planned.counterparty_hint?.trim().slice(0, 120) || null;
  return { ...(options.length ? { counterparty_options: options } : {}), ...(hint ? { counterparty_hint: hint } : {}) };
}
