// Titles of tasks the owner made by hand («Сделать задачей», «+ Задача»): AI names them by the same rule as the
// triage — «Контрагент: суть» (task manager spec, 2026-11-19). Once per task; a task the owner named stays as it is.
import type { JournalStore } from '../store/store.ts';
import type { LiveFeed } from '../server/live.ts';
import type { JournalEvent } from '../contracts/validate.ts';
import { tasksConfig } from '../config.ts';
import { nameId } from '../ids.ts';
import { isOpen, type Task } from './fold.ts';
import { describe, from } from './messages.ts';
import { foldCounterparties } from '../contacts/fold.ts';

// The title rule, shared with the triage instructions (planner.ts).
export const TITLE_RULE = `title — «Контрагент: суть». Контрагент — организация или клиент, о ком дело (название фирмы,
  имя клиента); нет контрагента — адрес (улица, дом, город); нет и адреса — имя человека. Суть — 3–7 слов: что нужно
  сделать или о чём просят («Анна Тестова: настройка принтера», «ул. Dzika 11: проверка кабеля», «ООО Ромашка: счёт
  за октябрь»). Своё дело владельца без контрагента — только суть («Купить кабель и коннекторы»). Не выдумывай
  контрагента, которого нет в сообщениях.`;

// `counterparty` — the task's counterparty from the directory, when set: the title starts with it.
export interface NameInput { title: string; counterparty: string | null; messages: { from: string; time: string; text: string }[] }
export interface NameOutput { title: string; usage?: { input_tokens: number; output_tokens: number } }
export type Namer = (input: NameInput) => Promise<NameOutput>;

export const NAMER_PROCESSOR = 'namer-ai-v1';
const SETTLE_MS = 10_000; // the owner may still be typing a title in the details panel
const RECENT_MS = 2 * 86_400_000;

// Tasks waiting for a name: made by the owner, open, with messages, not named by the owner or by AI yet.
export function unnamed(tasks: Task[], now: number): Task[] {
  return tasks.filter((task) => task.created_by === 'me' && !task.owner_titled && !task.processor && isOpen(task) && task.messages.length > 0
    && now - Date.parse(task.created_at) >= SETTLE_MS && now - Date.parse(task.created_at) <= RECENT_MS);
}

// Names up to `limit` waiting tasks; returns how many were renamed. Spending goes to the same monthly budget.
export async function nameTasks({ store, live, namer, tasks, now = Date.now(), limit = 3 }: {
  store: JournalStore; live: LiveFeed; namer: Namer; tasks: Task[]; now?: number; limit?: number;
}): Promise<number> {
  let renamed = 0;
  const counterparties = new Map(foldCounterparties(store.triage.contactEvents()).map((item) => [item.id, item.title]));
  for (const task of unnamed(tasks, now).slice(0, limit)) {
    const messages = task.messages.slice(-8).map((id) => store.getEvent(id)).filter((event): event is JournalEvent => Boolean(event))
      .map((event) => ({ event, view: describe(event, store) })).filter(({ view }) => !view.deleted && view.text.trim())
      .map(({ event, view }) => ({ from: from(event), time: event.ts, text: view.text.slice(0, 1000) }));
    if (!messages.length) continue;
    let output: NameOutput;
    const counterparty = (task.counterparty && counterparties.get(task.counterparty)) || null;
    try { output = await namer({ title: task.title, counterparty, messages }); } catch (error) {
      console.error('Naming failed', error instanceof Error ? error.message : error); // the triage goes on; next tick tries again
      break;
    }
    if (output.usage) {
      const price = tasksConfig.ai.price_per_mtok;
      store.triage.addUsage(new Date(now).toISOString().slice(0, 7), output.usage.input_tokens, output.usage.output_tokens,
        (output.usage.input_tokens * price.input + output.usage.output_tokens * price.output) / 1e6);
    }
    const title = output.title.trim().slice(0, 200);
    // Written even when unchanged: the processor marks the task as named, so it is not asked about again.
    const result = store.appendEvent({
      id: nameId(`task-name|${task.id}`), schema_version: 1, source: 'system', author: 'system', ts: new Date(now).toISOString(), kind: 'task_change',
      payload: { ref: { type: 'task', id: task.id }, data: { task: { op: 'update', ...(title && title !== task.title ? { title } : {}), processor: NAMER_PROCESSOR } } },
    });
    if (result.created) { live.publish(result.event); renamed += 1; }
  }
  return renamed;
}
