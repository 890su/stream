// The one interface the task triage talks to (development rule 9): a batch of new messages plus the open
// tasks in, a list of tasks out. The provider (AI now, scripts later) is a setting, not a code path.

export interface PlanMessage {
  id: string; time: string; source: string; from: string; text: string; tags: string[];
  reply_to?: string; continues?: string; in_tasks: string[];
}
export interface PlanTask { id: string; title: string; assignee: string; status: string; recent: string[] }
export interface PlanTemplate { name: string; tag: string; title: string; assignee: string; instruction: string }
export interface PlanInput { now: string; templates: PlanTemplate[]; open_tasks: PlanTask[]; messages: PlanMessage[] }

export interface PlannedTask {
  task_id: string | null; // an open task this continues, or null for a new one
  title: string;
  assignee: 'me' | 'ai' | 'system' | 'person';
  person: string | null;
  template: string | null;
  due: string | null;
  message_ids: string[];
  confidence: number;
  note: string | null;
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
        required: ['task_id', 'title', 'assignee', 'person', 'template', 'due', 'message_ids', 'confidence', 'note'],
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
        },
      },
    },
  },
} as const;

export const PLAN_INSTRUCTIONS = `Ты разбираешь новые сообщения личной ленты владельца в задачи.
Вход: шаблоны задач, открытые задачи и пачка новых сообщений (накопились за окно тишины).
Правила:
- Пачка — не одна задача. Каждое сообщение относится к нулю, одной или нескольким задачам.
- Если сообщение уточняет или продолжает открытую задачу, верни эту задачу с её task_id и id сообщения, title — как у неё.
- Два разных дела в одном сообщении — две задачи. Несколько сообщений об одном деле — одна задача.
- Болтовню, приветствия, «ок», служебное не превращай в задачи.
- Метка сообщения с шаблоном — сильный сигнал: template = name шаблона, assignee — из шаблона.
- title — коротко и по делу, по-русски, в повелительном наклонении («Перезвонить Марку про роутер»).
- assignee: me — делает владелец; ai — ИИ может сделать сам; system — скрипт или коннектор; person — другой человек (person — кто).
- due — дата ISO, только если она прямо следует из текста; иначе null.
- confidence от 0 до 1 — насколько ты уверен в задаче и её составе.
- Не придумывай фактов, которых нет в сообщениях.`;
