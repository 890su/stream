---
server: srv-150
server_path: ~/services/stream
connect: ssh -i ~/.ssh/id_ed25519 admin890brain@192.168.0.150
docker_service: ""
compose_file: ""
health_check: https://stream.sekond.pl/healthz
git_tracked: true
git_scope: [src/, web/, contracts/, registry/, deploy/, test/, package.json, pnpm-lock.yaml, tsconfig.json]
---

# Развёртывание Stream

Комплект подготовлен для пользовательского systemd на srv-150. Рабочий каталог —
`~/services/stream`, домен — `stream.sekond.pl`, HTTP слушает `127.0.0.1:3790`.
Команды ниже предназначены для ручной выкладки владельцем после публикации нужного коммита в GitHub.

## Подготовка и запуск

На srv-150 нужны Node 24 по пути `/usr/bin/node`, Git и пользовательский systemd.
Проверить `node --version` и `command -v node`. Если Node установлен по другому пути,
исправить `ExecStart` в обеих копиях service-файлов на сервере.

```bash
ssh -i ~/.ssh/id_ed25519 admin890brain@192.168.0.150
mkdir -p ~/services
git clone --branch step1-journal-capture https://github.com/890su/stream ~/services/stream
cd ~/services/stream
git rev-parse HEAD
cp .env.example .env
chmod 600 .env
```

В `.env` задать `STREAM_OWNER_TOKEN`, `PORT=3790`, `DATA_DIR=/home/admin890brain/services/stream/data`.
Токен создать локально на сервере через `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`,
перенести в `.env` и сохранить в менеджере паролей владельца. В шаблоне значения оставлены пустыми.
При запуске сервер требует минимум 32 символа. Рабочие зависимости устанавливать не требуется.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/stream.service deploy/stream-backup.service deploy/stream-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now stream.service stream-backup.timer
sudo loginctl enable-linger "$USER"
curl --fail http://127.0.0.1:3790/healthz
systemctl --user status stream.service
journalctl --user -u stream.service -n 50
```

## HTTPS через существующий Cloudflare Tunnel

Владелец добавляет маршрут `stream.sekond.pl` → `http://127.0.0.1:3790` в существующий
туннель srv-150. При управлении конфигурационным файлом это ingress с `hostname` и `service`,
размещённый перед завершающим правилом. При управлении через панель — published application route.
Для туннеля внутри контейнера проверить, что origin `127.0.0.1:3790` относится к сети хоста srv-150.

После применения маршрута проверить HTTPS и PWA.

```bash
curl --fail https://stream.sekond.pl/healthz
curl --fail -H "Authorization: Bearer $STREAM_OWNER_TOKEN" https://stream.sekond.pl/api/events
```

Для второй команды предварительно задать переменную в текущем shell из менеджера паролей.
Приложение принимает Bearer-токен. Настройка домена должна обеспечивать передачу запросов API
и `POST /share-target` напрямую приложению согласно существующему решению в `decisions.md`.

На Android открыть HTTPS-адрес в Chrome, ввести токен в «Настройки доступа», дождаться загрузки оболочки,
установить PWA. После первого открытия сервис-воркер принимает «Поделиться» и сохраняет исходные файлы
в IndexedDB. Серверный резервный обработчик `/share-target` требует Bearer-заголовок. Для обычного Android
Share используется установленный PWA с активированным сервис-воркером.

## Резервная копия и восстановление

Таймер запускает копирование ежедневно в 03:15 по времени сервера. `VACUUM INTO` создаёт согласованный
снимок базы, затем копируются все файлы из таблицы медиа этого снимка. Каждый запуск создаёт отдельную
датированную папку в `~/backups/stream`. Права новых файлов ограничены владельцем.

```bash
systemctl --user start stream-backup.service
systemctl --user list-timers stream-backup.timer
journalctl --user -u stream-backup.service -n 20
```

Копии следует переносить на отдельный носитель. Очистка старых копий остаётся ручной операцией владельца.
При восстановлении остановить `stream.service`, сохранить текущий каталог `DATA_DIR` отдельно,
скопировать содержимое выбранного снимка в новый `DATA_DIR`, проверить владельца файлов и запустить сервис.
Снимок включает `stream.db` и `media/`. Файлы WAL от прежней базы должны оставаться в прежнем каталоге.
Тест восстановления выполняется в `test/store.test.ts`.

## Обновление и откат

Перед обновлением сделать резервную копию и записать текущий `git rev-parse HEAD`.
При изменении оболочки или `registry/capture.json` разработчик повышает версию `CACHE` в `web/sw.js`.
Выполнить `git fetch`, затем `git checkout <проверенный-коммит>` в серверном checkout,
обновить изменившиеся unit-файлы, выполнить `systemctl --user daemon-reload` и
`systemctl --user restart stream.service`. Проверить `/healthz`, авторизованный список событий и новую запись.

Для отката выбрать записанный коммит, восстановить его unit-файлы и перезапустить сервис.
Если будущая версия меняет формат базы, использовать её отдельный план миграции и восстановления.
В этой версии схема создаётся при первом запуске.

## Проверка владельцем на телефоне

- [ ] Установка PWA и запуск по HTTPS.
- [ ] Ярлык «Голос» начинает запись максимум за два касания от разблокировки.
- [ ] Фото, текст и ссылка через «Поделиться» из галереи, WhatsApp и браузера.
- [ ] Голос и текст в режиме полёта, закрытие и повторный запуск PWA, возврат сети и отправка без дублей.
- [ ] Проигрывание голоса и открытие фото из ленты.
- [ ] Неделя ежедневной работы без потерь.

Синхронизация идёт при открытом приложении, возврате в него и восстановлении сети.
Браузер может запросить повторный доступ к микрофону. Токен и очередь хранятся в IndexedDB этого браузера.
Запрос постоянного хранения отправляется браузеру при запуске. Перед очисткой данных браузера нужно
дождаться пустой очереди. Ограничения объёма и интервалы повторов находятся в `registry/capture.json`.

Для временной проверки разработки на телефоне можно запустить на ПК
`cloudflared tunnel --url http://127.0.0.1:3790` и открыть выданный HTTPS-адрес.
