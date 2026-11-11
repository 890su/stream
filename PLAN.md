---
project_id: stream
project_type: deliverable
updated: 2026-11-11
---

# Plan: Stream

## In progress
- [ ] Шаг 1 «Журнал и быстрый ввод» — план: `docs/plans/2026-11-11-step1-journal-capture.md`
- [ ] Шаг 0 (владелец, параллельно): собрать 50 реальных сообщений за неделю в `golden/cases.jsonl` —
  см. `golden/README.md`. Нужен к шагу 3

## Решить
- [ ] Развёртывание на srv-150: поддомен `stream.sekond.pl` в Cloudflare Tunnel, Docker Compose или systemd
  (делается в конце шага 1, см. план шага, раздел «Развёртывание»)

## Next
- [ ] Шаг 2 «Нормализация»: голос → текст, фото → текст, сущности
- [ ] Шаг 3 «Разбор»: `interpret()`, пять целей из `registry/`, прогон по `golden/` (цель ≥80% без правок)
- [ ] Шаг 4 «Лента»: хронология, темы, фильтры, «верно» / «исправить»
- [ ] Шаг 5 «Задачи»: проекция, виды «Входящие» / «Сегодня» / «По темам», напоминания Web Push
- [ ] Шаг 6 «Ритуалы»: утренние три дела, вечерняя сводка

## Backlog (после MVP, по порядку из `CONCEPT.md` §7)
- [ ] Финансы из ленты: лог, выгрузка за месяц
- [ ] Коннектор CRM: iCRM или Планфикс
- [ ] Telegram-секретарь (бизнес-подключение)
- [ ] Проверка после заявки + просьба об отзыве
- [ ] Почта
- [ ] Оферты по запросу
- [ ] Отзывы Google
- [ ] Компаньон на Android: уведомления, звонки, вопрос после звонка
- [ ] Резервные коннекторы задач: Todoist, затем TickTick

## Done
- [x] Решения: стек Node 24 + TS без сборки + `node:sqlite`; iCRM не связываем (позже — коннектор);
  сервер srv-150 за Cloudflare Tunnel — 2026-11-11
  - Result: `decisions.md`, `docs/plans/2026-11-11-step1-journal-capture.md` (status: ready)
- [x] Структура проекта для Codex / Claude / Gemini: CONTEXT, CONCEPT, PLAN, decisions, контракты, реестр,
  план шага 1 — 2026-11-11
  - Result: `CONTEXT.md`, `CONCEPT.md`, `AGENTS.md`, `contracts/`, `registry/`, `golden/`, `docs/plans/`
- [x] Концепция проработана в документе: модель, конвейер, правила, ИИ, телефон, MVP — 2026-11-10…11
  - Result: https://claude.ai/artifact/2C1D9sLkW141UWgmN5Zco5
