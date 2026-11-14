---
server: srv-150
server_path: /srv/stream
connect: ssh -i ~/.ssh/id_ed25519 admin890brain@192.168.0.149   # LAN (IP changed from .150) or WireGuard 10.0.0.1
docker_service: stream (compose project "stream", separate from ~/n8n)
compose_file: /srv/stream/app/deploy/docker-compose.yml
health_check: https://stream.sekond.pl/healthz
git_tracked: true
git_scope: [src/, web/, contracts/, registry/, deploy/, package.json, tsconfig.json]
---

# Развёртывание Stream

Stream живёт на srv-150 отдельно от остальных проектов:

| Что | Где |
|---|---|
| Пользователь | системный `stream`, без входа и без домашнего каталога |
| Код | `/srv/stream/app` — checkout из GitHub, владелец root |
| База и медиа | `/srv/stream/data` (права 700, владелец `stream`) |
| Копии | `/srv/stream/backups`, ночью в 03:15, хранятся 30 дней |
| Секреты | `/srv/stream/.env` (600): `STREAM_OWNER_TOKEN`, `STREAM_UID`, `STREAM_GID` |
| Контейнер | свой compose-проект `stream` и своя сеть; без прав (`cap_drop: ALL`), файловая система только для чтения, 256 МБ, 0,5 CPU |
| Порт | `127.0.0.1:3790` на хосте; наружу — только через Cloudflare Tunnel |

С n8n, Twenty CRM и MCP Stream не делит ни каталоги, ни базу, ни сеть Docker, ни compose-файл.
Общие с ними только Docker и `cloudflared`.

## Установка и обновление

```bash
ssh -i ~/.ssh/id_ed25519 admin890brain@192.168.0.149
curl -fsSL https://raw.githubusercontent.com/890su/stream/main/deploy/install.sh -o /tmp/stream-install.sh
sudo bash /tmp/stream-install.sh            # или: sudo bash /srv/stream/app/deploy/install.sh <ref>
```

Скрипт повторяем: при повторном запуске он обновляет код до `main` (или до указанного коммита или ветки),
пересобирает образ и перезапускает контейнер. Токен создаётся один раз; посмотреть:
`sudo grep TOKEN /srv/stream/.env`. Сохранить его в менеджере паролей.

Проверка:

```bash
curl -fsS http://127.0.0.1:3790/healthz
cd /srv/stream/app/deploy && sudo docker compose ps && sudo docker compose logs --tail 50
systemctl list-timers stream-backup.timer
```

## Выкладка агентом без пароля

Один раз на сервере владелец разрешает запуск только скрипта установки без пароля:

```bash
echo 'admin890brain ALL=(root) NOPASSWD: /usr/bin/bash /srv/stream/app/deploy/install.sh *' | sudo tee /etc/sudoers.d/stream-deploy
sudo chmod 440 /etc/sudoers.d/stream-deploy && sudo visudo -c
```

Дальше агент выкладывает сам: `ssh … 'sudo -n /usr/bin/bash /srv/stream/app/deploy/install.sh <ref>'`.
Скрипт берёт код из GitHub, поэтому любой, кто может писать в репозиторий, по сути запускает код с правами
root на сервере — держите доступ к репозиторию только у себя. Отозвать: `sudo rm /etc/sudoers.d/stream-deploy`.

## HTTPS через существующий Cloudflare Tunnel

`install.sh` сам добавляет в локальный конфиг туннеля srv-150 (`/etc/cloudflared/config.yml`) правило
`stream.sekond.pl` → `http://127.0.0.1:3790` перед завершающим `http_status:404`: делает копию конфига,
проверяет его `cloudflared tunnel ingress validate`, создаёт DNS-запись и перезапускает `cloudflared`.
Перезапуск на несколько секунд прерывает другие адреса этого туннеля. Повторный запуск правило не дублирует.

Cloudflare Access на этот адрес не ставить (решение в `decisions.md`): доступ — по токену владельца.

```bash
curl -fsS https://stream.sekond.pl/healthz
```

## Копии и восстановление

Ручной запуск копии: `sudo systemctl start stream-backup.service`, журнал —
`journalctl -u stream-backup.service -n 20`. `VACUUM INTO` даёт согласованный снимок базы при работающем
сервере, рядом копируются все медиа из этого снимка. Копии лучше периодически уносить с сервера.

Восстановление:

```bash
cd /srv/stream/app/deploy && sudo docker compose stop
sudo mv /srv/stream/data /srv/stream/data.before-restore
sudo cp -a /srv/stream/backups/<снимок> /srv/stream/data
sudo chown -R stream:stream /srv/stream/data && sudo chmod 700 /srv/stream/data
sudo docker compose start
```

## Откат

`sudo bash /srv/stream/app/deploy/install.sh <прежний-коммит>`. Если версия меняет формат базы — сначала
восстановить копию, сделанную до обновления.

## Удаление

```bash
cd /srv/stream/app/deploy && sudo docker compose down --rmi local
sudo systemctl disable --now stream-backup.timer
sudo rm /etc/systemd/system/stream-backup.{service,timer}
# /srv/stream (данные и копии) удалять только вручную и осознанно
```

## Проверка владельцем на телефоне

- [ ] Установка PWA и запуск по HTTPS.
- [ ] Ярлык «Голос» начинает запись максимум за два касания от разблокировки.
- [ ] Фото, текст и ссылка через «Поделиться» из галереи, WhatsApp и браузера.
- [ ] Голос и текст в режиме полёта, закрытие и повторный запуск PWA, возврат сети и отправка без дублей.
- [ ] Проигрывание голоса и открытие фото из ленты.
- [ ] Неделя ежедневной работы без потерь.

На Android открыть адрес в Chrome, ввести токен в «Настройки доступа», установить PWA. Перед очисткой данных
браузера дождаться пустой очереди. Лимиты и интервалы повторов — в `registry/capture.json`.

Для проверки с телефона до выкладки: на ПК `cloudflared tunnel --url http://127.0.0.1:3790`.
