# Этап 1 «Пульт и фокус» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** «Задачи» открываются пультом: одно дело в работе со стопкой паузы, «Горит», «Сегодня», «Слежу»,
«Проекты» с динамикой, «Дальше» — порядок по вычисленной важности, без ИИ.

**Architecture:** Пульт — чистая проекция на устройстве (`web/pulse.js`) над уже свёрнутыми задачами, беседами и
проектами, как `filters.js`. Фокус (взять в работу, пауза, возврат) — обычные `task_change` через существующую
очередь (`taskquick.js`), плюс одно новое необязательное поле контракта `resume_note`. Пороги — данные в
`registry/pulse.json`, отдаются клиенту через `/capture-config.json`.

**Tech Stack:** Node 24 (TypeScript без сборки), ES-модули без сборщика в `web/`, `node --test`.

**Spec:** `docs/plans/2026-11-19-task-manager-spec.md` (§4.1, §4.5, §5, §5.4, §7); этапы —
`docs/plans/2026-11-19-task-manager-roadmap.md`.

## Global Constraints

- Журнал только дополняется; пауза и возврат — новые `task_change`, никаких UPDATE (правило 1).
- Пороги и веса — в `registry/pulse.json`, не в коде (правило 4).
- Один файл — одна задача, до ~300 строк, заголовок-комментарий на английском (правило 14).
- Новый модуль `web/*.js` — в `VERSIONED` в `src/server/static.ts` и `web/sw.js` (проверяет `test/service-worker.test.ts`).
- Текст интерфейса — по-русски; код, идентификаторы, коммиты — по-английски.
- Изменение контракта — запись в `decisions.md`; `resume_note` — необязательное поле v1, старые читатели не ломаются.
- Тестовые данные — вымышленные (правило 15).
- В этапе 1 нет: календаря, прогноза длительности, «Срочного», «ИИ подготовил», закрепления дела (этапы 2–4).

## Review Focus

1. **Чужое «в работе»** — задача со статусом `doing`, где исполнитель напарник, не попадает в «В работе» владельца
   (идёт в «Слежу»). Тест — Task 4.
2. **Два дела в `doing`** (старые данные, второе устройство) — в работе новейшее по `updatedAt`, остальные
   показываются в стопке паузы. Тест — Task 4.
3. **Отмена «▶ В работу»** — «Вернуть» в тосте восстанавливает оба дела (взятое и приостановленное). Тест — Task 3.
4. **Беседа в архиве** (`archived: true`) не попадает в «Горит», даже если ждёт ответа. Тест — Task 4.
5. **Всё пусто** — пульт показывает одну строку «Всё спокойно», а не шесть пустых заголовков. Проверка — Task 5.

---

### Task 1: `resume_note` в контракте и свёртке задачи

**Files:**
- Modify: `contracts/event.schema.json` (свойства `task`, рядом с `note`)
- Modify: `web/taskfold.js` (`foldTasks`), `src/tasks/fold.ts` (тот же список полей)
- Modify: `decisions.md`
- Test: `test/taskfold.test.ts`, `test/validation.test.ts`

**Interfaces:**
- Produces: событие `task_change` принимает `resume_note: string` (maxLength 200, пустая строка — снять);
  свёрнутая задача имеет `task.resumeNote: string | undefined`.

- [ ] **Step 1: Failing tests.** `validation.test.ts`: `task_change` с `{ op: 'update', status: 'todo', resume_note: 'проверить Wi-Fi' }`
  валиден; с `resume_note` длиной 201 — нет. `taskfold.test.ts` «resume note is folded and cleared»: create → update
  `resume_note: 'проверить Wi-Fi'` → `resumeNote === 'проверить Wi-Fi'`; ещё update `resume_note: ''` → `resumeNote === ''`.
- [ ] **Step 2:** `node --disable-warning=ExperimentalWarning --test test/taskfold.test.ts test/validation.test.ts` — FAIL.
- [ ] **Step 3:** схема: `"resume_note": { "type": "string", "maxLength": 200, "description": "Where the owner stopped when the task was paused (spec 5.4); '' clears." }`;
  в обеих свёртках `resume_note` → `task.resumeNote` (как `waiting_for` → `waitingFor`).
- [ ] **Step 4:** тесты — PASS; `pnpm typecheck` — без ошибок.
- [ ] **Step 5:** запись в `decisions.md` (2026-11-19: `resume_note`, зачем, необязательное v1). Commit
  `Task contract: resume_note for a paused task`.

### Task 2: `registry/pulse.json` и выдача клиенту

**Files:**
- Create: `registry/pulse.json`
- Modify: `src/config.ts` (экспорт `pulseConfig`), `src/server/http.ts:60` (`/capture-config.json` → поле `pulse`)
- Test: `test/api.test.ts`

**Interfaces:**
- Produces: `config.pulse` на клиенте:
  ```json
  { "version": 1, "rows": 4, "hot_wait_hours": 2, "watch_alert_days": 1, "stale_days": 7, "paused_remind_hours": 2,
    "money_templates": ["lead", "money"],
    "weights": { "hot": 1000, "money": 300, "blocks": 200, "due_soon": 100, "stale_per_day": 5 } }
  ```

- [ ] **Step 1: Failing test** «capture config carries the pulse thresholds»: `GET /capture-config.json` →
  `body.pulse.hot_wait_hours === 2`, `body.pulse.weights.hot === 1000`.
- [ ] **Step 2:** запустить `test/api.test.ts` — FAIL.
- [ ] **Step 3:** файл, тип и загрузка в `config.ts` по образцу `filtersConfig`; поле `pulse: pulseConfig` в ответе.
- [ ] **Step 4:** PASS. **Step 5:** Commit `Registry: pulse thresholds and weights`.

### Task 3: `web/focus.js` — одно дело в работе, пауза, возврат, время

**Files:**
- Create: `web/focus.js`
- Modify: `src/server/static.ts`, `web/sw.js` (`VERSIONED`); `web/taskactions.js` — `undoOf` восстанавливает
  `resume_note` из `task.resumeNote` (`''`, если не было)
- Test: `test/focus.test.ts`

**Interfaces:**
- Consumes: свёрнутая задача (`status`, `roles`, `items`, `history`, `resumeNote`), `involvesMe`, `undoOf`
  (`web/taskactions.js`).
- Produces (всё чистое):
  - `isMineToDo(task): boolean` — исполнитель я, или исполнителей нет и ответственный я.
  - `inWork(tasks): { current: Task | null, paused: Task[] }` — `current`: мои `doing`, новейший по `updatedAt`;
    `paused`: мои открытые с непустым `resumeNote` и прочие мои `doing`, новейшие первыми.
  - `resumeNoteOf(task): string` — текст первого неотмеченного пункта чеклиста, иначе `'в работе'`.
  - `startWork(task, current): Array<{ id: string, change: object }>` — `[{id: current.id, change: {op:'update', status:'todo', resume_note: resumeNoteOf(current)}}, {id: task.id, change: {op:'update', status:'doing', resume_note: ''}}]`;
    без `current` — только вторая часть.
  - `pauseWork(task): { id, change }` — `status: 'todo'`, `resume_note: resumeNoteOf(task)`.
  - `workedMinutes(task, now): number` — сумма отрезков истории, когда статус был `doing` (до `now`, если открыт).

- [ ] **Step 1: Failing tests** (`test/focus.test.ts`, задачи через `foldTasks` как в `filters.test.ts`):
  - «start pauses the current task with where it stopped»: текущее с пунктами `[{text:'кабель', done:true}, {text:'проверить Wi-Fi', done:false}]`
    → `startWork(new, current)[0].change.resume_note === 'проверить Wi-Fi'`, `[1].change.status === 'doing'`.
  - «a partner's doing is not mine in work»: `doing` с `executors: ['tg:1']` → `inWork(...).current === null`.
  - «two doing: newest is current, the other is paused».
  - «undo of start restores both»: для каждой части `undoOf(task, change)` возвращает прежние `status` и `resume_note`.
  - «worked minutes sum doing spans»: doing 10:00 → todo 10:30 → doing 11:00, `now` 11:15 → `45`.
- [ ] **Step 2:** FAIL. **Step 3:** реализация. **Step 4:** PASS (и `test/service-worker.test.ts`).
- [ ] **Step 5:** Commit `Focus: one task in work, pause with a resume note, worked time`.

### Task 4: `web/pulse.js` — блоки пульта и важность

**Files:**
- Create: `web/pulse.js`
- Modify: `src/server/static.ts`, `web/sw.js` (`VERSIONED`)
- Test: `test/pulse.test.ts`

**Interfaces:**
- Consumes: `inWork`, `isMineToDo` (Task 3); `dueState`, `isOpen`, `involvesMe` (`taskfold.js`); `matchesFilter`
  (`filters.js`: поле `snoozed`, `next`, `idea`); беседы из `conversations()` (`state`, `archived`, `views`, `title`, `key`).
- Produces:
  - `importance(task, { now, config }): number` — сумма весов `config.weights`: `hot` (просрочено или срок сегодня),
    `money` (`template` в `money_templates`), `blocks` (`review` и проверяющий я), `due_soon` (срок завтра),
    `stale_per_day × дней без изменений` (до 30).
  - `pulseBlocks({ tasks, conversations, projects, now, config }) → { work, paused, hot, today, watch, watchAlerts, projects, later }`:
    - `work`, `paused` — из `inWork`.
    - `hot` — элементы `{ kind: 'task', task }` и `{ kind: 'conversation', conversation, waitingHours }`:
      мои и «слежу» задачи с `dueState` `overdue` или `today`; беседы `state === 'mine'`, не `archived`, последний
      входящий старше `hot_wait_hours`.
    - `today` — мои открытые (не `filed`, не `idea`, не `snoozed`): `next === true`, `status === 'inbox'`, `review`
      с проверяющим мной, срок завтра.
    - `watch` — `waiting` с моим участием и поручённые (проверяющий я, исполнитель не я); `watchAlerts` — из них
      со сроком в прошлом или без изменений ≥ `watch_alert_days`.
    - `later` — остальные мои открытые, кроме `snoozed`, `filed`, `idea`.
    - Каждая задача — ровно в одном из `work / paused / hot / today / watch / later`, проверка сверху вниз;
      «Команда» (`involvesMe` false) не попадает никуда. Внутри блока — по `importance` убыв., затем по сроку.
  - `projectHealth(project, tasks, { now, config }) → { done7, new7, open, overdue, staleDays, next, health }` —
    `health`: `'red'` при `overdue > 0`, `'yellow'` без следующего шага у проекта с целью или при
    `staleDays ≥ stale_days`, иначе `'green'`. `pulseBlocks.projects` — активные проекты, red → yellow → green.

- [ ] **Step 1: Failing tests** (`test/pulse.test.ts`, вымышленные данные, `now = 2026-11-19 12:00`):
  - «every task lands in exactly one block» — набор из 10 задач разных видов: объединение блоков без повторов,
    «Команда», `filed`, `snoozed` отсутствуют.
  - «overdue mine and overdue waiting both burn» — оба в `hot`, не в `today` / `watch`.
  - «conversation waiting over the threshold burns; archived does not» (Review Focus 4).
  - «partner's doing goes to watch» (Review Focus 1); «two doing» (Review Focus 2) — через `inWork`.
  - «money outranks a plain task with the same due».
  - «project health: overdue red, goal without next yellow, moving green; done7 / new7 counted over 7 days».
- [ ] **Step 2:** FAIL. **Step 3:** реализация. **Step 4:** PASS. **Step 5:** Commit `Pulse: blocks, importance, project health`.

### Task 5: пульт на экране

**Files:**
- Create: `web/pulseview.js` (DOM блоков; до ~200 строк)
- Modify: `registry/filters.json` (первым — `{ "id": "pulse", "title": "Пульт", "pinned": true, "view": "pulse", "all": [] }`),
  `src/config.ts` (тип фильтра: `view?: 'pulse'`), `web/taskview.js` (ветка `filter.view === 'pulse'`; счётчик чипа
  пульта = `hot + today`), `web/taskquick.js` (действия `start`, `pause`, `resume` с «Вернуть»), `web/tasklist.js`
  (кнопка «▶» в строке при `quick.start`), `web/screens.css`, `src/server/static.ts`, `web/sw.js`
- Test: `test/task-lists.test.ts`, `test/filters.test.ts`

**Interfaces:**
- Consumes: `pulseBlocks`, `projectHealth` (Task 4); `startWork`, `pauseWork`, `workedMinutes` (Task 3); `taskRow`,
  `sectionHeader` (`tasklist.js`).
- Produces: `pulseNodes(ctx) → Node[]` (`ctx` — как у `taskViewNodes` плюс `conversations`, `projects`, `config.pulse`,
  `onOpenConversation(key)`).

Вид (ТЗ §5):
- Карточка «⏵ В работе: …» — название, «N мин» (`workedMinutes`), «дальше: …» (`resumeNote` или первый пункт),
  кнопки «Готово» и «⏸ Пауза». Нет дела в работе, есть пауза — «Вернуться к: … — дальше: …» [Вернуться].
  Под карточкой «⏸ ждут возврата: N» (касание раскрывает); приостановленное дольше `paused_remind_hours` —
  с пометкой «на паузе N ч».
- Блоки «🔥 Горит · ▶ Сегодня · 👁 Слежу (N · ⚠ M) · 📊 Проекты · ⏭ Дальше»: заголовок со счётчиком, до `rows`
  строк, «ещё N» раскрывает; пустой блок — одна строка «✓ Слежу — всё по плану». «Дальше» свёрнут.
- Строка беседы в «Горит»: «Ответить: <title> · ждёт N ч», касание открывает беседу.
- Строка проекта: точка здоровья, название, «↑done7 сделано · open откр», для жёлтого/красного — причина.
- Всё пусто — одна строка «Всё спокойно» (Review Focus 5).

- [ ] **Step 1: Failing tests:** `filters.test.ts` «first filter is the pulse»: `filtersConfig.filters[0].view === 'pulse'`;
  `task-lists.test.ts` — существующие тесты «Сегодня» берут фильтр по `id: 'today'`, не `[0]` (поправить, где нужно).
- [ ] **Step 2:** FAIL. **Step 3:** реализация по списку файлов.
- [ ] **Step 4:** `pnpm test` и `pnpm typecheck` — PASS.
- [ ] **Step 5: Проверка в браузере** (навык `run`): `pnpm start`, ширина 375 px, вымышленные задачи — пульт
  открывается по умолчанию; «▶» на строке берёт дело в работу и приостанавливает прежнее; «Вернуть» в тосте
  откатывает оба; «⏸ Пауза» → карточка «Вернуться к…»; пустые блоки свёрнуты; на 1100 px+ подробности справа.
- [ ] **Step 6:** Commit `Pulse view: the default of «Задачи»`.

### Task 6: концепция, карта кода, план, выкладка

**Files:** `CONCEPT.md` (§2.8 — одно дело в работе и `resume_note`; §5 — пульт по умолчанию), `docs/CODEMAP.md`
(`focus.js`, `pulse.js`, `pulseview.js`, `registry/pulse.json`), `PLAN.md` (этап 1 — в «In progress — проверки
владельца»; этапы 2–7 — в «Пакеты»).

- [ ] **Step 1:** правки документов. **Step 2:** `pnpm test` — PASS. **Step 3:** Commit, push;
  `ssh srv-150 sudo -n bash /srv/stream/app/deploy/install.sh step1-journal-capture`; `https://stream.sekond.pl/healthz` → `{"ok":true}`.
