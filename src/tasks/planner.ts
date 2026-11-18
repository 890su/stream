// The one interface the task triage talks to (development rule 9): a batch of new messages plus the open
// tasks in, a list of tasks out. The provider (AI now, scripts later) is a setting, not a code path.

export interface PlanMessage {
  id: string; time: string; source: string; from: string; text: string; tags: string[];
  reply_to?: string; continues?: string; in_tasks: string[];
}
// A task given as context: its last messages, the conversations (sources) they came from, its last activity.
export interface PlanTask { id: string; title: string; assignee: string; status: string; recent: string[]; chats: string[]; last_at: string }
export interface PlanTemplate { name: string; tag: string | null; title: string; assignee: string; filed: boolean; instruction: string }
// context — earlier messages of the same conversation, already triaged: to understand, not to assign.
export interface PlanInput { now: string; templates: PlanTemplate[]; open_tasks: PlanTask[]; closed_tasks: PlanTask[]; context: PlanMessage[]; messages: PlanMessage[] }

export interface PlannedTask {
  task_id: string | null; // an open or recently closed task this continues, or null for a new one
  title: string;
  assignee: 'me' | 'ai' | 'system' | 'person';
  person: string | null;
  template: string | null;
  due: string | null;
  message_ids: string[];
  confidence: number;
  note: string | null;
  filed: boolean; // nothing to do but file it: the task is created already done
  done: boolean; // the messages say the work is finished: the owner is asked to close it with a report
  alternatives: string[]; // other tasks these messages may belong to: the owner is asked right on the message
}
export interface PlanOutput { tasks: PlannedTask[]; usage?: { input_tokens: number; output_tokens: number } }

export type Planner = (input: PlanInput) => Promise<PlanOutput>;

// JSON Schema of PlanOutput.tasks for structured output.
export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task_id', 'title', 'assignee', 'person', 'template', 'due', 'message_ids', 'confidence', 'note', 'filed', 'done', 'alternatives'],
        properties: {
          task_id: { type: ['string', 'null'] },
          title: { type: 'string' },
          assignee: { type: 'string', enum: ['me', 'ai', 'system', 'person'] },
          person: { type: ['string', 'null'] },
          template: { type: ['string', 'null'] },
          due: { type: ['string', 'null'] },
          message_ids: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          note: { type: ['string', 'null'] },
          filed: { type: 'boolean' },
          done: { type: 'boolean' },
          alternatives: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export const PLAN_INSTRUCTIONS = `Ты разбираешь новые сообщения личной ленты владельца в задачи.
Вход: шаблоны задач, открытые задачи (open_tasks), недавно завершённые (closed_tasks), context — предыдущие сообщения этой же беседы (уже разобраны, in_tasks —
их задачи) и messages — пачка новых сообщений (накопились, пока беседа не замолчала).
Правила:
- context — только чтобы понять, о чём речь и к какой задаче относится новое; id из context в ответ не включай.
  Новое сообщение, продолжающее разговор из context, обычно относится к задаче этого разговора (in_tasks).
- Пачка — не одна задача. Каждое сообщение относится к одной или нескольким задачам.
- У КАЖДОГО сообщения пачки должен быть итог: его id есть хотя бы в одной задаче ответа.
- Если делать ничего не нужно, только разложить, верни задачу с filed: true — она сразу закрыта. Для этого
  шаблоны с filed: true: diary (самочувствие, события дня), plan (идея или доработка проекта), note
  (мысль, справка), chatter (болтовня, «ок», служебное). Несколько таких сообщений одного вида — одна задача.
- filed: false — настоящее дело, которое кто-то должен сделать.
- done: true — сообщения говорят, что дело сделано («готово», «сделал», «закончил», «установил, работает»).
  Задачу это не закрывает: владельца спросят и попросят отчёт. У filed-задач done всегда false.
- Если сообщение уточняет или продолжает открытую задачу, верни эту задачу с её task_id и id сообщения, title — как у неё.
  Дело может длиться много дней: сверяй собеседника (chats — откуда сообщения задачи), предмет и last_at.
- Если сообщение явно продолжает задачу из closed_tasks (то же дело снова ожило: «опять не работает», «а ещё…»),
  верни её task_id — задачу вернут в работу. Не возвращай закрытое ради похожей темы: новое дело — новая задача.
- alternatives — id других задач (из open_tasks или closed_tasks), к которым эти сообщения тоже могут относиться,
  до трёх, самые вероятные первыми. Только при настоящем сомнении: владельца спросят прямо на сообщении. Иначе [].
- Два разных дела в одном сообщении — две задачи. Несколько сообщений об одном деле — одна задача.
- Болтовню, приветствия, «ок», служебное не превращай в дела: это filed: true с шаблоном chatter.
- Метка сообщения с шаблоном — сильный сигнал: template = name шаблона, assignee — из шаблона.
- title — коротко и по делу, по-русски, в повелительном наклонении («Перезвонить Марку про роутер»).
- assignee: me — делает владелец; ai — ИИ может сделать сам; system — скрипт или коннектор; person — другой человек (person — кто).
- due — дата ISO, только если она прямо следует из текста; иначе null.
- confidence от 0 до 1 — насколько ты уверен в задаче и её составе.
- Не придумывай фактов, которых нет в сообщениях.`;
