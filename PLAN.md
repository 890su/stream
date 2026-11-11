---
project_id: stream
project_type: deliverable
updated: 2026-11-11
---

# Plan: Stream

## In progress
- [ ] Шаг 1 — проверки владельца по `docs/plans/2026-11-11-step1-journal-capture.md` и `deploy/DEPLOY.md`.
  Код выложен на https://stream.sekond.pl. Открыты: Android (установка PWA), ярлыки, «Поделиться», режим полёта, неделя использования.
- [ ] Шаг 0 (владелец, параллельно): собрать 50 реальных сообщений за неделю в `golden/cases.jsonl` —
  см. `golden/README.md`. Нужен к шагу 3

## Решить
- [ ] Слить ветку `step1-journal-capture` в `main` после проверки на телефоне; затем `install.sh` без аргумента

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
- [x] Мгновенная синхронизация между устройствами (SSE `/api/live`) — 2026-11-11. Проверено двумя Chrome с
  разными профилями: сообщение появляется на другом клиенте за ~0,14 с без перезагрузки
  - Result: `src/server/live.ts`, `web/live.js`, `test/live.test.ts`
- [x] Файлы клиента по адресу сборки `/v/<build>/` — исправлен «смешанный» интерфейс на телефоне — 2026-11-11
  - Result: `src/server/static.ts`, `web/sw.js`, `test/shell.test.ts`
- [x] Экран-чат вместо вкладок: лента пузырей, строка ввода, метки (`payload.tags`), скрепка, голос/«Отправить»
  — 2026-11-11. Проверено на localhost (светлая и тёмная тема, 375 px): метки, текст, фото с подписью,
  загрузка фото с сервера. Голос во встроенном браузере не проверить (микрофон заблокирован) — на телефоне
  - Result: `web/index.html`, `web/styles.css`, `web/composer.js`, `web/voice.js`, `web/bubble.js`, `web/feed.js`
- [x] Развёртывание на srv-150 (192.168.0.149): контейнер `stream` в `/srv/stream`, https://stream.sekond.pl,
  ночная копия — 2026-11-11. Сервер освобождён: зеркало Drive, MCP Projects и кеш Docker удалены
  - Result: `deploy/install.sh`, `deploy/docker-compose.yml`, `deploy/DEPLOY.md`
- [x] Шаг 1 «Журнал и быстрый ввод» — код и комплект развёртывания готовы, 2026-11-11.
  - Result: `src/`, `web/`, `test/`, `registry/capture.json`, `package.json`, `tsconfig.json`, `.env.example`, `deploy/`.
  - Проверки: `pnpm test` (23 теста) и `pnpm typecheck`. Ручная проверка на localhost (мобильный вид):
    токен, текст → «Принято» в ленте, 201/200/409/401. Сервис-воркер во встроенном браузере не проверен —
    там он не регистрируется вовсе; ошибка регистрации больше не останавливает отправку очереди.
  - Приёмка владельца на телефоне остаётся в In progress и в плане шага 1.
- [x] Решения: стек Node 24 + TS без сборки + `node:sqlite`; iCRM не связываем (позже — коннектор);
  сервер srv-150 за Cloudflare Tunnel — 2026-11-11
  - Result: `decisions.md`, `docs/plans/2026-11-11-step1-journal-capture.md` (status: ready)
- [x] Структура проекта для Codex / Claude / Gemini: CONTEXT, CONCEPT, PLAN, decisions, контракты, реестр,
  план шага 1 — 2026-11-11
  - Result: `CONTEXT.md`, `CONCEPT.md`, `AGENTS.md`, `contracts/`, `registry/`, `golden/`, `docs/plans/`
- [x] Концепция проработана в документе: модель, конвейер, правила, ИИ, телефон, MVP — 2026-11-10…11
  - Result: https://claude.ai/artifact/2C1D9sLkW141UWgmN5Zco5
