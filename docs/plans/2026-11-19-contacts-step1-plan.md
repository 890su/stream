# П7, шаг 1 «Справочник без Google» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** люди и контрагенты в журнале; у задачи — контрагент (разбор ставит или спрашивает «Кто контрагент?»),
он же в названии; карточки человека и контрагента справа; человек из беседы — одним касанием.

**Architecture:** по образцу проектов (§2.11): новые события `contact_change` и `counterparty_change`, справочник —
их свёртка на сервере (`src/contacts/fold.ts`, для разбора) и на устройстве (`web/contacts.js`, для экрана). Человек
связан с перепиской «точками» — сторонами `tel:+…` и `tg:<id>`. Контрагент задачи — новое поле задачи `counterparty`
(id контрагента) с `counterparty_options` и `counterparty_hint` от разбора, как `project` / `project_options`.

**Tech Stack:** Node 24 (TypeScript без сборки), ES-модули без сборщика в `web/`, `node --test`.

**Spec:** `docs/plans/2026-11-19-contacts-design.md` (§3 модель, §6 «как видно», §7 шаг 1).

## Global Constraints

- Журнал только дополняется; правки справочника — новые события (правило 1). Данные людей — не в git (правило 15):
  тесты на вымышленных именах и номерах.
- Новые виды событий и поля — Event v1, необязательные; запись в `decisions.md` (правило 13).
- Один файл — одна задача, до ~300 строк; `web/feed.js` уже 302 строки — в него только подключение.
- Новый модуль `web/*.js` — в `VERSIONED` (`src/server/static.ts`, `web/sw.js`).
- Текст интерфейса — по-русски; код и коммиты — по-английски.
- Разбор меняет инструкцию → новая версия `triage-ai-v11`; прогон по `golden/` — отметить, если не сделан.
- Нет в шаге 1: Google, контакты телефона, «Где хранится» (шаги 2–4), слияние дублей.

## Review Focus

1. **Два человека с одним номером** (`tel:` точка у двоих) — разбор и экран берут первого созданного, не падают;
   строка в карточке «тот же номер у …». Тест — Task 2.
2. **Контрагент, поставленный владельцем**, разбор не меняет (как проект). Тест — Task 3.
3. **Номер в разной записи** (`+48 600 300 400`, `0048600300400`, `600300400`) — одна точка через `phoneNumber`. Тест — Task 2.
4. **Удалённый контрагент** (`status: archived`) не предлагается разбором и в «Кто контрагент?», но у старых задач
   виден с пометкой «в архиве». Тест — Task 2 (свёртка) и Task 4 (варианты).
5. **«+ Новый» с пустым названием** не создаёт контрагента (кнопка неактивна). Проверка — Task 4 (чистая функция формы).

---

### Task 1: контракт — `contact_change`, `counterparty_change`, контрагент задачи

**Files:** `contracts/event.schema.json`; `src/contracts/task.ts` (проверка по образцу `checkProject`);
`decisions.md`; тесты `test/validation.test.ts`, `test/api.test.ts` (POST принимает).

**Interfaces — Produces (схема):**
- `kind`: + `contact_change`, `counterparty_change`; `ref.type`: + `person`, `counterparty` (id — uuid).
- `payload.data.contact` (только у `contact_change`): `op` create | update; `name` (`^\S[^\n]{0,119}$`);
  `phones`, `emails`, `telegram`, `addresses` — массивы строк до 200; `note` до 1000; `status` active | deleted;
  `roles` — массив `{ counterparty: uuid, title: string ≤ 60 }`.
- `payload.data.counterparty` (только у `counterparty_change`): `op`; `kind` org | address; `title` (`^\S[^\n]{0,119}$`);
  `address` ≤ 200; `side` pl | by | null; `tax_id` ≤ 30; `status` active | archived.
- `task`: + `counterparty` (uuid | null), `counterparty_options` (uuid[] ≤ 3), `counterparty_hint` (строка ≤ 120 | null).
- Новый контрагент и новый человек требуют `title` / `name`.

- [ ] **Step 1:** тесты: валидны `contact_change` (create с name, phones, roles) и `counterparty_change` (create org с side pl);
  отклоняются: `contact_change` без name при create, `payload.data.contact` у `task_change`, `ref.type` не `person`,
  `counterparty.kind: 'firm'`, `task.counterparty: 'x'`.
- [ ] **Step 2:** FAIL. **Step 3:** схема и `checkContact` / `checkCounterparty` в `src/contracts/task.ts`.
- [ ] **Step 4:** PASS + `pnpm typecheck`. **Step 5:** `decisions.md` (новые виды, поля задачи), commit
  `Contract: people and counterparties, the counterparty of a task`.

### Task 2: свёртка справочника — сервер и устройство

**Files:** Create `src/contacts/fold.ts`, `web/contacts.js` (зеркало, чистое); Modify `src/store/triage.ts`
(`contactEvents()` — оба вида, как `projectEvents()`), `web/feed.js` (только: свернуть и отдать `people()`,
`counterparties()`); Test `test/contacts.test.ts`.

**Interfaces — Produces (одинаково на сервере и в `web/contacts.js`):**
- `foldPeople(events) → Person[]`; `Person = { id, name, phones, emails, telegram, addresses, note, status, roles: {counterparty, title}[], points: string[], createdAt }`.
  `points` — стороны: `tel:` из `phones` через `phoneNumber` (`src/tasks/parties.ts` / `web/parties.js`), `tg:<id>`
  из `telegram`, если это цифры.
- `foldCounterparties(events) → Counterparty[]`; `Counterparty = { id, kind, title, address, side, taxId, status }`.
- `personOf(party, people) → Person | null` — первый созданный активный с этой точкой.
- `peopleOf(counterpartyId, people) → { person, title }[]`.

- [ ] **Step 1:** тесты (вымышленные): создание и правка человека; `points` из трёх записей одного номера —
  одна `tel:+48600300400` (Review Focus 3); `personOf` при двух людях с одним номером — первый (Review Focus 1);
  удалённый человек не находится; контрагент в архиве остаётся в свёртке со `status: 'archived'` (Review Focus 4);
  `peopleOf` с должностями; сервер и клиент дают одинаковый результат на одних событиях.
- [ ] **Step 2–4:** FAIL → реализация → PASS. **Step 5:** commit `People and counterparties as folds of the journal`.

### Task 3: разбор ставит контрагента (`triage-ai-v11`)

**Files:** `src/tasks/planner.ts` (вход и выход), `src/tasks/triage.ts` (запись, как `projectChange`; при нехватке
места — функция `counterpartyChange` в `src/tasks/counterparty.ts`), `src/tasks/namer.ts` (`TITLE_RULE`: контрагент
— из справочника, если поставлен), `registry/tasks.json` (`triage-ai-v11`); Test `test/triage.test.ts`.

**Interfaces:**
- Consumes: `foldPeople`, `foldCounterparties`, `personOf` (Task 2).
- `PlanInput.counterparties: { id, kind, title, address, side, people: string[] }[]` — активные; `PlanMessage.person`
  — имя человека по стороне сообщения или null.
- `PlannedTask`: + `counterparty: string | null`, `counterparty_options: string[]`, `counterparty_hint: string | null`
  (в схеме ответа обязательные).
- `counterpartyChange(planned, task, counterparties) → Record<string, unknown>`: ставит `counterparty`, если его нет у
  задачи и id известен; иначе `counterparty_options` (только известные активные, ≤ 3) и `counterparty_hint`; задачу с
  контрагентом от владельца не трогает.

- [ ] **Step 1:** тесты: известный контрагент ставится новой задаче; неизвестный id отбрасывается, остаются варианты и
  подсказка «ООО Пример»; задача, где контрагента поставил владелец (`author: 'me'`), не меняется (Review Focus 2);
  архивный не попадает во вход разбора.
- [ ] **Step 2–4:** FAIL → реализация (инструкция: «counterparty — id из counterparties, о ком дело; не уверен — null,
  варианты и counterparty_hint: как назвать нового — фирма или адрес»; заголовок — `TITLE_RULE`) → PASS.
- [ ] **Step 5:** commit `Triage v11: the counterparty of a task, or options and a hint`.

### Task 4: «Контрагент» в задаче и «Кто контрагент?»

**Files:** Create `web/counterpartyline.js` (строка в подробностях задачи, по образцу `projectLine` из
`web/projectpanel.js`); Modify `web/taskdetails.js` (вставить строку под проектом), `web/tasklist.js` (`rowParts`:
контрагент первым фактом вместо проекта, если есть; «кто?» при `counterparty_options`), `web/shared.js`
(`makePersonChange`, `makeCounterpartyChange` как `makeProjectChange`); Test `test/counterpartyline.test.ts` (чистые части).

**Interfaces:**
- `counterpartyLine(task, { counterparties, people, save, saveCounterparty, onOpen }) → Node`.
- Чистые: `counterpartyChoices(task, counterparties) → { options: Counterparty[], hint: string | null }` — варианты
  разбора (только активные) и подсказка; `newCounterparty(form) → { op: 'create', kind, title, address?, side } | null` —
  `null` при пустом названии (Review Focus 5); у вида «адрес» `title` = адрес.

Вид: «Контрагент: ▸ ООО Пример» (касание — карточка контрагента, «Сменить»). Без контрагента — «Кто контрагент?»:
чипы вариантов; «+ Создать «ООО Пример»» по подсказке; «+ Новый» → две кнопки «Организация» / «Адрес», поле названия
(или адреса), сторона PL / BY / не знаю → «Создать»: событие контрагента, затем задача получает его id. Автор задачи —
человек, у которого нет должности у этого контрагента, — предлагается «Связать <имя> как …» (поле должности, «живёт»
по умолчанию для адреса).

- [ ] **Step 1:** тесты чистых функций: варианты без архивных; подсказка без вариантов; `newCounterparty` с пустым и
  с пробельным названием → null; вид «адрес» кладёт адрес в `title` и `address`.
- [ ] **Step 2–4:** FAIL → реализация → PASS. **Step 5:** commit `«Кто контрагент?» in task details; the counterparty in rows`.

### Task 5: карточки человека и контрагента; человек из беседы

**Files:** Create `web/personcard.js` (карточка человека и форма правки), `web/counterpartycard.js` (карточка
контрагента); Modify `web/details.js` (`show({ kind: 'person' | 'counterparty', id })`, `openPerson`, `openCounterparty`),
`web/chatview.js` (кнопка «Контакт» в шапке беседы: открыть человека по стороне беседы или создать — имя из названия
чата, точка `tg:` / `tel:`), `web/index.html`, `web/panels.css`; Test `test/personcard.test.ts` (чистые части).

**Interfaces:**
- `openPerson(id)`, `openCounterparty(id)` в `details.js`; `personFromConversation(conversation) → { name, phones, telegram }`
  (чистая: `tel:+…` → телефон, `tg:<id>` → telegram).
- Карточка человека: имя (касание — переименовать), телефоны, почта, Telegram, адреса, заметка — правка на месте
  (сохранение — `contact_change` с изменёнными полями); должности у контрагентов (касание — карточка контрагента);
  его беседы и открытые задачи (по точкам). Карточка контрагента: вид, название / адрес, сторона, люди с должностями,
  открытые задачи (по `counterparty`), «В архив».

- [ ] **Step 1:** тесты чистых частей: `personFromConversation` для чата Telegram и для номера; разбор строки
  телефонов «+48 600 300 400, 0048600300401» в массив.
- [ ] **Step 2–4:** FAIL → реализация → PASS.
- [ ] **Step 5: Проверка в браузере** (навык `run`, 375 px, вымышленные данные): беседа → «Контакт» → карточка;
  задача → «Кто контрагент?» → «+ Новый» → «Адрес» → «Создать» → в строке и названии задачи контрагент; карточка
  контрагента показывает человека и задачу; «назад» закрывает карточку.
- [ ] **Step 6:** commit `Person and counterparty cards; a person from a conversation`.

### Task 6: концепция, карта кода, план, выкладка

**Files:** `CONCEPT.md` (§2.5 люди и контрагенты, §2.8 контрагент задачи, §5 карточки), `docs/CODEMAP.md`, `PLAN.md`
(П7 шаг 1 — на проверку владельца; шаги 2–5 — в пакетах).

- [ ] **Step 1:** правки документов (только свои строки: у владельца могут быть незакоммиченные правки).
- [ ] **Step 2:** `pnpm test` (последовательно при сбоях `ETIMEDOUT`), `pnpm typecheck` — PASS.
- [ ] **Step 3:** commit, push, выкладка `install.sh step1-journal-capture`, `https://stream.sekond.pl/healthz` → `{"ok":true}`.
