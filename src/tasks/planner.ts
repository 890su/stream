// Task triage interface for deciding what work to track and what to keep in the conversation.
import { TITLE_RULE } from './namer.ts';
import type { MessageDirection } from './messages.ts';


export interface PlanMessage {
  id: string; time: string; source: string; from: string; party: string; text: string; tags: string[];
  direction: MessageDirection; forwarded?: true;
  reply_to?: string; continues?: string; in_tasks: string[];
  default_project?: string | null; // a hint: the project of this message's source, when the matter fits its scope (CONCEPT.md §2.11)
  person?: string | null; // the directory's name for the author, when known (contacts design §3)
  directive?: string[]; // the owner's tags that order the triage (registry/tags.json "directive": true, triage-ai-v21)
}
// A counterparty the triage may set (contacts design §6): active ones, with their people and job titles.
export interface PlanCounterparty { id: string; kind: string; title: string; address: string; side: string | null; people: string[] }
// A task given as context: its last messages, the conversations (sources) they came from, its last activity.
// items — its checklist; owner_titled — the owner named it, so it is never renamed (CONCEPT.md §2.8).
export interface PlanTask { id: string; title: string; project?: string | null; assignee: string; roles: object; status: string; recent: string[]; chats: string[]; last_at: string; items: { text: string; done: boolean }[]; owner_titled: boolean }
export interface PlanTemplate { name: string; tag: string | null; title: string; assignee: string; filed: boolean; instruction: string }
// context — the last session of the same conversation before the new messages (triage-ai-v19): to understand, not
// to assign; earlier_available — the AI may answer need_earlier and get the session before it.
// An active project: the triage may put tasks in it, in one of its sections.
export interface PlanProject { id: string; title: string; kind: string; scope: string; sections: { id: string; title: string; role?: string }[] }
export interface PlanInput { now: string; job_days: number; projects: PlanProject[]; counterparties: PlanCounterparty[]; templates: PlanTemplate[]; open_tasks: PlanTask[]; closed_tasks: PlanTask[]; context: PlanMessage[]; earlier_available: boolean; messages: PlanMessage[] }

export interface PlannedTask {
  task_id: string | null; // an open record this continues, or a closed one only as a link (repeats use repeat_of); null for a new one
  title: string;
  responsible: string; // a party: who answers for the result
  executors: string[]; // parties: who does it (may be empty)
  author: string | null; // a party: who asked
  template: string | null;
  due: string | null;
  message_ids: string[];
  confidence: number;
  reason?: string | null; // why these messages go to this task (or a new one), one line — the AI log (triage-ai-v15)
  note: string | null;
  filed: boolean; // nothing to do but file it: the task is created already done
  done: boolean; // the messages say the work is finished: the owner is asked to close it with a report
  alternatives?: string[]; // before v21: other tasks these messages may belong to — since v21 a question instead
  repeat_of?: string | null; // a closed task asked for again: this is a new one with its own report, never a reopen (v21)
  items?: string[]; // checklist items this adds: a step of a job, or the things a list names (CONCEPT.md §2.8)
  rename?: string | null; // a general title for a job that grew past one action
  project?: string | null; // the project of the task (an id from projects), or null when unsure or none
  section?: string | null; // a section of that project
  project_options?: string[]; // when unsure: up to three candidate projects, the owner is asked
  counterparty?: string | null; // an id from counterparties, or null when unsure or none
  counterparty_options?: string[]; // when unsure: up to three candidate counterparties
  counterparty_hint?: string | null; // how to name a new counterparty: a firm or an address
  report?: PlannedReport | null; // with done: what the messages say was done — a draft of the closing report
}
// A report draft from the conversation (task manager spec §11): the result in one line and the numbers named.
export interface PlannedReport { note: string | null; duration_min: number | null; cost: number | null; expenses: number | null; currency: string | null }
// The AI is unsure where messages belong (v21): the owner picks — an existing record, a new one or nothing.
export interface PlannedQuestion {
  message_ids: string[]; text: string;
  options: { label: string; task_id: string | null; title: string | null; template: string | null; nothing: boolean }[];
}
export interface PlanOutput {
  tasks: PlannedTask[];
  conversation_only: string[]; // messages that need no reply from the owner (optional since v21: no outcome per message)
  questions?: PlannedQuestion[]; // required in the schema; absent in answers before v21 (anthropic.ts defaults to [])
  // Whether the conversation is over after these messages (owner, 2026-11-21, triage-ai-v18): what the other side still
  // waits for from the owner when no task covers it, else null. Keeps the conversation in the queue (web/queue.js).
  unfinished?: string | null;
  // The last session does not say what the new messages are about: ask again with the session before it (v19).
  need_earlier?: boolean;
  usage?: { input_tokens: number; output_tokens: number };
}

export type Planner = (input: PlanInput) => Promise<PlanOutput>;

// The API allows at most 16 union-typed (nullable) parameters in a schema, nested ones counted. These string fields
// are plain strings with '' for none (the instruction says so); `restoreNulls` maps '' back to null.
export const EMPTY_AS_NULL = { task: ['task_id', 'author', 'template', 'due', 'reason', 'note', 'repeat_of', 'rename', 'project', 'section', 'counterparty', 'counterparty_hint'], option: ['task_id', 'title', 'template'] } as const;
const orNull = (value: unknown) => (typeof value === 'string' && !value.trim() ? null : value ?? null);
export function restoreNulls<T extends Pick<PlanOutput, 'tasks'> & { questions?: unknown }>(answer: T): T & { questions: PlannedQuestion[] } {
  const tasks = answer.tasks.map((task) => {
    const restored: Record<string, unknown> = { ...task };
    for (const key of EMPTY_AS_NULL.task) if (key in restored) restored[key] = orNull(restored[key]);
    return restored as unknown as PlannedTask;
  });
  const questions = (Array.isArray(answer.questions) ? answer.questions as PlannedQuestion[] : []).map((question) => ({
    ...question,
    options: (question.options ?? []).map((option) => {
      const restored: Record<string, unknown> = { ...option };
      for (const key of EMPTY_AS_NULL.option) restored[key] = orNull(restored[key]);
      return restored as unknown as PlannedQuestion['options'][number];
    }),
  }));
  return { ...answer, tasks, questions };
}

// JSON Schema of the planner's structured output.
export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks', 'conversation_only', 'questions', 'unfinished', 'need_earlier'],
  properties: {
    conversation_only: { type: 'array', items: { type: 'string' } },
    questions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['message_ids', 'text', 'options'],
        properties: {
          message_ids: { type: 'array', items: { type: 'string' } },
          text: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['label', 'task_id', 'title', 'template', 'nothing'],
              properties: { label: { type: 'string' }, task_id: { type: 'string' }, title: { type: 'string' }, template: { type: 'string' }, nothing: { type: 'boolean' } },
            },
          },
        },
      },
    },
    unfinished: { type: ['string', 'null'] },
    need_earlier: { type: 'boolean' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task_id', 'title', 'responsible', 'executors', 'author', 'template', 'due', 'message_ids', 'confidence', 'reason', 'note', 'filed', 'done', 'repeat_of', 'items', 'rename', 'project', 'section', 'project_options', 'report', 'counterparty', 'counterparty_options', 'counterparty_hint'],
        properties: {
          task_id: { type: ['string', 'null'] },
          reason: { type: 'string' },
          title: { type: 'string' },
          responsible: { type: 'string' },
          executors: { type: 'array', items: { type: 'string' } },
          author: { type: ['string', 'null'] },
          template: { type: ['string', 'null'] },
          due: { type: ['string', 'null'] },
          message_ids: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          note: { type: 'string' },
          filed: { type: 'boolean' },
          done: { type: 'boolean' },
          repeat_of: { type: ['string', 'null'] },
          items: { type: 'array', items: { type: 'string' } },
          rename: { type: 'string' },
          project: { type: ['string', 'null'] },
          section: { type: 'string' },
          project_options: { type: 'array', items: { type: 'string' } },
          counterparty: { type: ['string', 'null'] },
          counterparty_options: { type: 'array', items: { type: 'string' } },
          counterparty_hint: { type: 'string' },
          report: {
            type: ['object', 'null'], additionalProperties: false, required: ['note', 'duration_min', 'cost', 'expenses', 'currency'],
            properties: { note: { type: ['string', 'null'] }, duration_min: { type: ['number', 'null'] }, cost: { type: ['number', 'null'] }, expenses: { type: ['number', 'null'] }, currency: { type: ['string', 'null'] } },
          },
        },
      },
    },
  },
} as const;

// triage-ai-v21 (docs/plans/2026-11-23-conversation-records-design.md): the conversation's records first, a task for any
// request, done work as a done task, a repeat of a closed record as a new one, a question when unsure where it belongs.
export const PLAN_INSTRUCTIONS = `Ты разбираешь беседу владельца: что из новых сообщений записать и к каким записям они относятся.
Запись — задача по шаблону (дело, заявка, перезвонить, деньги, заметка, план, дневник).
Вход: шаблоны; open_tasks — открытые записи этого собеседника (из этой беседы, где он сторона, с его контрагентом) и
несколько недавних записей владельца из других бесед; closed_tasks — недавно закрытые; context — последняя сессия этой
же беседы перед новыми сообщениями (переписка без долгого перерыва; in_tasks — записи её сообщений); messages — новые
сообщения (накопились, пока беседа не замолчала).
Правила:
- context — только чтобы понять, о чём речь и к какой записи относится новое; id из context в ответ не включай.
- need_earlier — если по context непонятно, о чём новые сообщения (ответ на то, чего в context нет: «ок, тогда в
  субботу», «а сколько?», «сделал», «как договаривались»), и earlier_available: true, верни need_earlier: true,
  tasks: [], conversation_only: [], questions: [], unfinished: null — тебе дадут ещё и предыдущую сессию. Иначе
  need_earlier: false и обычный разбор. Не проси раньше, если и так понятно.
- Продолжение разговора — продолжение записи. Сначала сверь новые сообщения с open_tasks и открытыми записями из
  in_tasks: уточнение, повтор просьбы, «ну что там?», ответ по делу, «готово», «спасибо, работает» — это та же запись:
  её task_id, title — как у неё.
  Новая запись — только если ни одна не подходит по сути (предмет, оборудование, заказ, адрес, выезд). Дело может длиться
  много дней: сверяй собеседника (chats — откуда сообщения записи), предмет и last_at. Сообщение из другого чата относи
  к записи, только если оно явно о том же деле; то же слово или сайт в разговоре о другом — не повод.
- Новая просьба того же собеседника по открытому делу («а ещё…», «забыл…», «и вот это») — не новая задача: task_id
  дела, просьба — пунктом в items, новый срок — в due. Если дело было одним действием, а теперь их несколько, rename —
  общее название «Собеседник: предмет», но только когда owner_titled: false; иначе rename: "". Изменения существующей
  записи (название, срок, пункты, «сделано») владелец подтверждает сам.
- Задача — владельца просят что-то сделать, он обещает или берётся сделать, договорились о встрече или выезде. Кто
  просит — клиент, напарник, родные или друзья — неважно: «отправь», «позвони», «купи», «забери» от близких — такая же
  задача. Договорились о выезде, встрече, звонке или приезде к владельцу на день или время («в субботу в 14», «завтра
  после обеда») — задача с due на этот день, даже если остальная переписка — подбор времени; «ок», «до встречи»
  подтверждают договорённость.
- Сомневаешься, есть ли просьба (задача или ничего), — верни задачу с честным confidence: владелец подтвердит её ✓ или
  отклонит ✕, это дёшево.
- Сомневаешься, к какой записи относятся сообщения (подходят две-три, или существующая либо новая), — не выбирай
  наугад: задай вопрос в questions, а эти сообщения в tasks не включай. Нет сомнения — questions: [].
- Сделанная работа — просьба и её выполнение уложились в разговор (удалённое подключение, настройка, заказ сделан,
  «готово, работает»): задача task_id: null, done: true, report — черновик отчёта. Если на эту работу есть открытая
  запись — её task_id и done: true.
- Бесплатная консультация — ничего: вопрос или консультация, которая решается ответом в переписке или звонком
  (как быть, что выбрать, сколько стоит, что значит ошибка, что нажать — и собеседник делает сам), бывает часто,
  в оплату не идёт. Задача — когда из разговора выросла работа (выезд, удалённое подключение, настройка, заказ, счёт,
  оферта) или владелец обещал сделать позже; подсказки собеседнику, что нажать, — не пункты этой задачи.
- Закрытые записи (closed_tasks) в работу не возвращаются. Отклик на закрытую запись без новой просьбы («спасибо,
  работает», «всё заработало», «получил») — её task_id только как ссылка: done: false, items: [], rename: "", due: null;
  это не повтор и не возврат в работу. Новая просьба по закрытому делу («опять не работает», «по гарантии», «сделай ещё
  раз») — новая задача: task_id: null, repeat_of — id закрытой записи, у неё будет свой отчёт. У остальных задач
  repeat_of: null.
- Деньги — назван расход или приход (чек, оплата, «оплатил», перевод, наличка), в том числе по закрытой записи:
  задача с template money; note — сумма, валюта, за что; counterparty — клиент, если он есть.
- Заметка, идея, план, дневник — только из ввода владельца (source me, direction note) или когда владелец пометил
  сообщение меткой этого вида (в tags или directive); иначе из чужой переписки их не заводи. Это задачи с filed: true — они сразу закрыты: diary (самочувствие, события дня), plan (идея,
  для которой нет подходящего проекта), note (справка, которую владелец хочет сохранить: адрес, код, договорённость).
  Несколько таких материалов одного вида — одна задача. Идея или мысль о доработке известного проекта — не filed:
  задача в этом проекте, section — раздел с role ideas; шаг, который прямо следующий («завтра сделаю…»), — раздел с
  role next.
- directive — метки-указания владельца на сообщении, приказ разбору; весят больше твоего мнения. Метка шаблона (tag в
  шаблонах) — дай по этому сообщению запись этого шаблона: найди, что сделать или что сохранить, title — суть. Не
  выходит — вопрос в questions с причиной в text. Обычная метка (tags) с шаблоном — сильный сигнал: template = name
  шаблона. #доход — запись template money о приходе; #поручить — задача, executors — тот, кому поручают (party или
  name:Имя), responsible: me; не назван — вопрос в questions.
- Ничего — обсуждение работы и клиентов без просьбы, новости, мнения, рассказ о своих делах, передача сведений,
  приветствия, служебное. Итог у каждого сообщения не обязателен: просто разговор не попадает ни в tasks, ни в
  questions.
- conversation_only — сообщения вне записей, которые не требуют от владельца ответа (ок, приветствие, служебное);
  не обязательно, можно []. Один id не включай и в conversation_only, и в задачу.
- filed: false — настоящее дело, которое кто-то должен сделать. done: true — сообщения говорят, что дело сделано
  («готово», «сделал», «установил, работает»); у существующей записи это вопрос владельцу «сделано?» с отчётом. У
  filed-задач done всегда false.
- report — только при done: true, иначе null. Черновик отчёта из того, что написано в беседе: note — что сделано,
  одной строкой («Настроил печать из дома на офисный принтер»); duration_min — сколько заняло в минутах, если
  названо («полчаса» = 30, «1,5 ч» = 90); cost — сколько стоит работа для клиента, expenses — затраты, currency —
  PLN, BYN, EUR или USD, если названы. Чего нет в сообщениях — null; не выдумывай.
- Два разных дела в одном сообщении — две задачи. Несколько сообщений об одном деле — одна задача. Одно сообщение
  перечисляет несколько мелочей одного дела («купить кабель, коннекторы и стяжки») — одна задача, items — пункты.
  Отдельные дела владельца (из его заметок и личных просьб) — каждое своей задачей, в чеклист чужого дела не складывай.
- items — короткие пункты по-русски, одна строка каждый; пункты, которые уже есть у задачи (items в open_tasks), не
  повторяй. Новая задача из одного действия — items: []. rename — только для задачи с task_id, иначе "". Пункт — только
  шаг, который исполнителю задачи ещё предстоит сделать. Не пункты: указания владельца собеседнику, действия
  собеседника, сделанное («отправлен», «исправлено»), факты и статусы, советы. Такое — в note задачи или ничего.
- Проекты (projects — активные проекты с разделами; scope — что к проекту относится, словами владельца). У каждой
  задачи project — id проекта, к которому она относится, или null; section — id его раздела или "". В проект кладёшь только
  дело, которое подходит под его scope (по смыслу дела, а не по чату или стране): личные, семейные и бытовые дела, чужие
  для проекта работы — project: null, даже если сообщение пришло из рабочего чата. default_project — лишь подсказка:
  проект источника, если дело подходит под его scope. У проекта без scope — только явно его дела. Если уверенности нет —
  project: null и project_options — до трёх id вероятных проектов (владельца спросят); иначе project_options: []. Задача,
  у которой проект уже есть (project в open_tasks), остаётся в нём: верни его же или null. filed-задачам project: null.
- Контрагенты (counterparties — организации и адреса частных клиентов, с людьми и должностями). У каждой задачи
  counterparty — id контрагента, о ком дело: организация автора (person сообщения и people контрагента), адрес из
  сообщений. Не уверен — counterparty: null, counterparty_options — до трёх вероятных id, и counterparty_hint — как
  назвать нового, если его нет в списке: название фирмы или адрес («ООО Ромашка», «ул. Dzika 11, Варшава»); иначе
  counterparty_hint: "". Своё дело владельца без контрагента — counterparty: null, counterparty_hint: "". Задача, у которой
  контрагент уже есть, остаётся с ним. filed-задачам — null и "". Название задачи начинай с контрагента из списка.
- unfinished — закончена ли беседа после новых сообщений (смотри и context). Если собеседник ещё ждёт от владельца
  действия — выезда, звонка, ответа по существу, расчёта, присылки, — и ни одна задача это не покрывает (ни новая из
  tasks этого ответа, ни открытая из open_tasks этого собеседника), напиши коротко, чего ждут, со сроком, если он
  назван: «ждёт выезд в субботу в 14:00», «ждёт цену на камеры». Иначе null: разговор исчерпан, ответ дан,
  договорённость уже в задаче или ждёт сам владелец.
- ${TITLE_RULE}
- responsible — кто отвечает за итог: me, если просят владельца или он сам взялся; иначе — сторона того, кого просят
  (party из messages). executors — кто делает (может быть пусто, пока никто не взялся); ai / system — для шаблонов ИИ и
  системы. author — сторона того, кто попросил. Задачи заводятся и там, где владельца нет: клиент просит напарника,
  напарник — другого напарника; тогда me не ставится ни в одну роль.
- due — дата ISO, только если она прямо следует из текста; иначе null.
- confidence от 0 до 1 — насколько ты уверен в задаче и её составе.
- reason — одна строка для владельца: почему эти сообщения относятся к этой записи или почему нужна новая — какие
  слова, люди, чат, адрес связывают их.
- questions — когда не уверен, куда отнести сообщения: message_ids; text — короткий вопрос по-русски («О каком деле
  речь?»); options — 2–3 варианта, вероятный первым: существующая запись (task_id, label — её название, title и
  template "", nothing false), новая запись (task_id "", title, template, label — коротко), ничего (nothing true,
  task_id, title и template "", label «Ничего»).
- Пустое значение — "" (не null) у reason, note, rename, section, counterparty_hint и у task_id, title, template в
  вариантах вопроса; null — там, где правила выше говорят null.
- Не придумывай фактов, которых нет в сообщениях.`;
