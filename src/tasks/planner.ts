// The one interface the task triage talks to (development rule 9): a batch of new messages plus the open
// tasks in, a list of tasks out. The provider (AI now, scripts later) is a setting, not a code path.
import { TITLE_RULE } from './namer.ts';


export interface PlanMessage {
  id: string; time: string; source: string; from: string; party: string; text: string; tags: string[];
  reply_to?: string; continues?: string; in_tasks: string[];
  default_project?: string | null; // a hint: the project of this message's source, when the matter fits its scope (CONCEPT.md §2.11)
  person?: string | null; // the directory's name for the author, when known (contacts design §3)
}
// A counterparty the triage may set (contacts design §6): active ones, with their people and job titles.
export interface PlanCounterparty { id: string; kind: string; title: string; address: string; side: string | null; people: string[] }
// A task given as context: its last messages, the conversations (sources) they came from, its last activity.
// items — its checklist; owner_titled — the owner named it, so it is never renamed (CONCEPT.md §2.8).
export interface PlanTask { id: string; title: string; project?: string | null; assignee: string; roles: object; status: string; recent: string[]; chats: string[]; last_at: string; items: { text: string; done: boolean }[]; owner_titled: boolean }
export interface PlanTemplate { name: string; tag: string | null; title: string; assignee: string; filed: boolean; instruction: string }
// context — earlier messages of the same conversation, already triaged: to understand, not to assign.
// An active project: the triage may put tasks in it, in one of its sections.
export interface PlanProject { id: string; title: string; kind: string; scope: string; sections: { id: string; title: string; role?: string }[] }
export interface PlanInput { now: string; job_days: number; projects: PlanProject[]; counterparties: PlanCounterparty[]; templates: PlanTemplate[]; open_tasks: PlanTask[]; closed_tasks: PlanTask[]; context: PlanMessage[]; messages: PlanMessage[] }

export interface PlannedTask {
  task_id: string | null; // an open or recently closed task this continues, or null for a new one
  title: string;
  responsible: string; // a party: who answers for the result
  executors: string[]; // parties: who does it (may be empty)
  author: string | null; // a party: who asked
  template: string | null;
  due: string | null;
  message_ids: string[];
  confidence: number;
  note: string | null;
  filed: boolean; // nothing to do but file it: the task is created already done
  done: boolean; // the messages say the work is finished: the owner is asked to close it with a report
  alternatives: string[]; // other tasks these messages may belong to: the owner is asked right on the message
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
        required: ['task_id', 'title', 'responsible', 'executors', 'author', 'template', 'due', 'message_ids', 'confidence', 'note', 'filed', 'done', 'alternatives', 'items', 'rename', 'project', 'section', 'project_options', 'report', 'counterparty', 'counterparty_options', 'counterparty_hint'],
        properties: {
          task_id: { type: ['string', 'null'] },
          title: { type: 'string' },
          responsible: { type: 'string' },
          executors: { type: 'array', items: { type: 'string' } },
          author: { type: ['string', 'null'] },
          template: { type: ['string', 'null'] },
          due: { type: ['string', 'null'] },
          message_ids: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          note: { type: ['string', 'null'] },
          filed: { type: 'boolean' },
          done: { type: 'boolean' },
          alternatives: { type: 'array', items: { type: 'string' } },
          items: { type: 'array', items: { type: 'string' } },
          rename: { type: ['string', 'null'] },
          project: { type: ['string', 'null'] },
          section: { type: ['string', 'null'] },
          project_options: { type: 'array', items: { type: 'string' } },
          counterparty: { type: ['string', 'null'] },
          counterparty_options: { type: 'array', items: { type: 'string' } },
          counterparty_hint: { type: ['string', 'null'] },
          report: {
            type: ['object', 'null'], additionalProperties: false, required: ['note', 'duration_min', 'cost', 'expenses', 'currency'],
            properties: { note: { type: ['string', 'null'] }, duration_min: { type: ['number', 'null'] }, cost: { type: ['number', 'null'] }, expenses: { type: ['number', 'null'] }, currency: { type: ['string', 'null'] } },
          },
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
- Задача — только дело, которое после переписки ещё кто-то должен сделать. Сомневаешься — задачи нет: сообщение
  остаётся в беседе (filed: true, шаблон chatter). Лишняя задача хуже пропущенной: владелец видит всю беседу сам.
- Остаётся в беседе (filed: true, chatter), а не задача и не пункт:
  * личная и семейная переписка о текущем: где ты, когда будешь, кто с детьми, кто заболел, поел ли, советы,
    лекарства, просьбы, которые выполняются тут же в переписке. Задача в личной переписке — только явная просьба
    сделать что-то потом, вне этого разговора («запиши Рому к врачу на пятницу», «купи завтра молоко»);
  * консультация: владелец объясняет собеседнику, что нажать или сделать, и тот делает сам, пока они пишут
    («держи кнопку», «зайди в настройки», «попробуй ещё раз»). Это способ помочь, а не шаги владельцу. Если сама
    просьба о помощи — дело (клиент, работа), задача одна, без этих шагов в items;
  * рассказ о себе и своих делах, мнения, новости, обсуждение без поручения;
  * то, что уже сделано в этой же переписке, без отчёта о работе для клиента (пароль отправлен, ссылку скинул).
- Если делать ничего не нужно, только разложить, верни задачу с filed: true — она сразу закрыта. Для этого
  шаблоны с filed: true: diary (самочувствие, события дня — только из своих заметок владельца, source me, не из
  переписки), plan (идея, для которой нет подходящего проекта), note (справка, которую владелец явно хочет сохранить:
  адрес, код, договорённость), chatter (всё, что остаётся в беседе). Несколько таких сообщений одного вида — одна задача.
- filed: false — настоящее дело, которое кто-то должен сделать.
- done: true — сообщения говорят, что дело сделано («готово», «сделал», «закончил», «установил, работает»).
  Задачу это не закрывает: владельца спросят и попросят отчёт. У filed-задач done всегда false.
- report — только при done: true, иначе null. Черновик отчёта из того, что написано в беседе: note — что сделано,
  одной строкой («Настроил печать из дома на офисный принтер»); duration_min — сколько заняло в минутах, если
  названо («полчаса» = 30, «1,5 ч» = 90); cost — сколько стоит работа для клиента, expenses — затраты, currency —
  PLN, BYN, EUR или USD, если названы. Чего нет в сообщениях — null; не выдумывай.
- Если сообщение уточняет или продолжает открытую задачу, верни эту задачу с её task_id и id сообщения, title — как у неё.
  Дело может длиться много дней: сверяй собеседника (chats — откуда сообщения задачи), предмет и last_at.
- Если сообщение явно продолжает задачу из closed_tasks (то же дело снова ожило: «опять не работает», «а ещё…»),
  верни её task_id — задачу вернут в работу. Не возвращай закрытое ради похожей темы: новое дело — новая задача.
- alternatives — id других задач (из open_tasks или closed_tasks), к которым эти сообщения тоже могут относиться,
  до трёх, самые вероятные первыми. Только при настоящем сомнении: владельца спросят прямо на сообщении. Иначе [].
- Два разных дела в одном сообщении — две задачи. Несколько сообщений об одном деле — одна задача.
- Три формы работы (выбирай по источнику и смыслу):
  * Дело — в рабочей переписке (source tg|… или phone) с клиентом, напарником, поставщиком. Новая просьба того же
    собеседника по тому же делу (тот же предмет, оборудование, заказ, выезд: «а ещё…», «забыл…», «и вот это») — не новая
    задача: верни задачу дела с её task_id, а саму просьбу — пунктом в items. Дело из closed_tasks, закрытое не раньше
    job_days дней назад, о котором человек пишет снова («опять сломалось», «по гарантии»), — тоже его task_id и пункт в items.
    Если дело было одним действием, а теперь их несколько, rename — общее название «Собеседник: предмет»
    («Анна: настройка компьютера»), но только когда owner_titled: false; иначе rename: null.
  * Отдельные задачи — заметки владельца (source me) и явные просьбы в личной переписке сделать что-то потом (семья,
    друзья, бытовые дела): каждое дело — своя задача, в чеклист чужой задачи не складывай. Остальная личная
    переписка остаётся в беседе (см. выше).
  * Список — одно сообщение перечисляет несколько мелочей одного дела («купить кабель, коннекторы и стяжки») — одна
    задача, items — пункты.
- Проекты (projects — активные проекты с разделами; scope — что к проекту относится, словами владельца). У каждой
  задачи project — id проекта, к которому она относится, и section — id его раздела, или null. В проект кладёшь только
  дело, которое подходит под его scope (по смыслу дела, а не по чату или стране): личные, семейные и бытовые дела, чужие
  для проекта работы — project: null, даже если сообщение пришло из рабочего чата. default_project — лишь подсказка:
  проект источника, если дело подходит под его scope. У проекта без scope — только явно его дела. Если уверенности нет —
  project: null и project_options — до трёх id вероятных проектов (владельца спросят); иначе project_options: []. Задача, у которой проект уже есть
  (project в open_tasks), остаётся в нём: верни его же или null. filed-задачам project: null.
- Контрагенты (counterparties — организации и адреса частных клиентов, с людьми и должностями). У каждой задачи
  counterparty — id контрагента, о ком дело: организация автора (person сообщения и people контрагента), адрес из
  сообщений. Не уверен — counterparty: null, counterparty_options — до трёх вероятных id, и counterparty_hint — как
  назвать нового, если его нет в списке: название фирмы или адрес («ООО Ромашка», «ул. Dzika 11, Варшава»); иначе
  counterparty_hint: null. Своё дело владельца без контрагента — counterparty: null, hint: null. Задача, у которой
  контрагент уже есть, остаётся с ним. filed-задачам — null. Название задачи начинай с контрагента из списка.
- Идея, мысль о доработке известного проекта — не filed: задача в этом проекте, section — раздел с role ideas.
  Шаг, который прямо следующий («завтра сделаю…», «надо начать с…»), — раздел с role next.
- items — короткие пункты по-русски, одна строка каждый; пункты, которые уже есть у задачи (items в open_tasks),
  не повторяй. Новая задача из одного действия — items: []. rename — только для задачи с task_id, иначе null.
  Пункт — только шаг, который исполнителю задачи ещё предстоит сделать. Не пункты: указания владельца собеседнику,
  действия собеседника, сделанное («отправлен», «исправлено»), факты и статусы («офис закажет в понедельник»),
  советы, просьбы к владельцу внутри личной переписки. Такое — в note задачи или ничего. Сомневаешься — items: [].
- Болтовню, приветствия, «ок», служебное не превращай в дела: это filed: true с шаблоном chatter.
- Метка сообщения с шаблоном — сильный сигнал: template = name шаблона, executors — из шаблона.
- ${TITLE_RULE}
- responsible — кто отвечает за итог: me, если просят владельца или он сам взялся; иначе — сторона того, кого просят
  (party из messages). executors — кто делает (может быть пусто, пока никто не взялся); ai / system — для шаблонов ИИ и
  системы. author — сторона того, кто попросил. Задачи заводятся и там, где владельца нет: клиент просит напарника,
  напарник — другого напарника; тогда me не ставится ни в одну роль.
- due — дата ISO, только если она прямо следует из текста; иначе null.
- confidence от 0 до 1 — насколько ты уверен в задаче и её составе.
- Не придумывай фактов, которых нет в сообщениях.`;
