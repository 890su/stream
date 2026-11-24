// «✨ Сверить с перепиской» on a record (docs/plans/2026-11-23-conversation-records-design.md «✨ на записи»): what
// the rechecker is shown and answers, its structured-output schema and instruction (recheck-ai-v1). The answer is
// only proposals; src/tasks/recheck.ts turns them into the owner's ✓ ✕. Pure — no store, no AI.
import { TITLE_RULE } from './namer.ts';
import type { PlanMessage, PlanTask } from './planner.ts';

// in_record — the message is in the record now; owner_linked_elsewhere — it is in another confirmed record (not by a
// system link the owner left alone): context only, never proposed for `add`.
export type RecheckMessage = PlanMessage & { in_record: boolean; owner_linked_elsewhere: boolean };
// rejected — what the owner already turned down ✕ in earlier rechecks of this record (kind + value): not offered again.
export interface RecheckInput { now: string; record: PlanTask; others: PlanTask[]; messages: RecheckMessage[]; rejected?: { kind: string; value: string }[] }

export const RECHECK_KINDS = ['add', 'remove', 'rename', 'due', 'items', 'status', 'merge'] as const;
// value — the new title (rename), a date (due; null — no due), one checklist item (items), what was done in one line
// (status: «похоже, сделано»); target_task_id — where removed messages go (remove; null — a new record) or the
// duplicate to merge in (merge).
export interface RecheckProposal { kind: typeof RECHECK_KINDS[number]; message_ids: string[]; value: string | null; target_task_id: string | null; reason: string }
export type Rechecker = (input: RecheckInput) => Promise<{ proposals: RecheckProposal[]; usage?: { input_tokens: number; output_tokens: number } }>;

// The API allows at most 16 union-typed parameters in a schema: none here — "" stands for none, `restoreRecheck`
// maps it back to null (as `restoreNulls` does for the planner).
export const RECHECK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'message_ids', 'value', 'target_task_id', 'reason'],
        properties: {
          kind: { type: 'string', enum: [...RECHECK_KINDS] },
          message_ids: { type: 'array', items: { type: 'string' } },
          value: { type: 'string' },
          target_task_id: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

const orNull = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
export function restoreRecheck(answer: { proposals?: unknown }): { proposals: RecheckProposal[] } {
  const list = Array.isArray(answer.proposals) ? answer.proposals as Record<string, unknown>[] : [];
  return { proposals: list.map((item) => ({ kind: item.kind as RecheckProposal['kind'], message_ids: Array.isArray(item.message_ids) ? item.message_ids.map(String) : [],
    value: orNull(item.value), target_task_id: orNull(item.target_task_id), reason: String(item.reason ?? '') })) };
}

export const RECHECK_INSTRUCTIONS = `Ты сверяешь одну запись владельца (задачу) с перепиской, из которой она выросла, и предлагаешь правки.
Ничего не применяется само: владелец подтвердит каждое предложение ✓ или отклонит ✕. Лучше меньше, но точно.
Вход: record — запись (название, статус, роли, срок, пункты items, owner_titled — название дал владелец); others —
другие записи этих собеседников и записи, в которых есть сообщения из этой переписки; messages — переписка записи
от сессии перед её первым сообщением до сегодня, по времени: in_record — сообщение уже в записи, in_tasks — в каких
записях оно сейчас, owner_linked_elsewhere — владелец сам отнёс его к другой записи (только контекст); rejected —
то, что владелец уже отклонил в прошлых сверках этой записи (вид и значение; у add и remove — id сообщений, у merge —
id дубля): не предлагай это снова.
Виды предложений (kind):
- add — подтянуть сообщения, которые относятся к этой записи по сути (тот же предмет, оборудование, заказ, адрес,
  выезд), а в записи их нет: уточнения, повтор просьбы, «ну что там?», «готово», ответы по делу. message_ids — эти
  сообщения. Не предлагай сообщения с owner_linked_elsewhere: true и сообщения, которые уже in_record.
- remove — убрать из записи сообщения (in_record: true), которые про другое дело. target_task_id — id записи из
  others, куда они относятся, или "" — если для них нужна новая запись или они просто разговор.
- rename — название не отражает суть записи: value — новое название. Даже если owner_titled: true, предложить можно,
  но только если старое явно неверно.
- due — срок записи расходится с перепиской (договорились о другом дне): value — дата ISO (ГГГГ-ММ-ДД) или "" —
  срока нет. message_ids — сообщения, где это сказано.
- items — в переписке есть шаг этого дела, которого нет в пунктах: value — один короткий пункт по-русски; одно
  предложение — один пункт. Не пункты: сделанное, действия собеседника, советы, факты.
- status — по переписке дело сделано («готово», «сделал», «работает»), а запись открыта: value — что сделано, одной
  строкой (черновик отчёта), message_ids — где это видно.
- merge — в others есть дубль этой записи (то же дело, тот же собеседник, открыт): target_task_id — его id.
  Сообщения и пункты дубля перейдут в эту запись, дубль закроется.
Правила:
- Каждое предложение — с message_ids, на которых оно основано (у rename и merge можно []), и reason — одна строка
  для владельца по-русски: какие слова, люди, даты это показывают.
- Обсуждение работы, приветствия, служебное, просто разговор — не повод подтягивать сообщение.
- Если запись и переписка сходятся — proposals: [].
- id бери только из входа; target_task_id — только из others. Не придумывай фактов, которых нет в сообщениях.
- Пустое значение — "" (у value и target_task_id), не null. due — только дата ГГГГ-ММ-ДД, без текста после неё.
- ${TITLE_RULE}`;
