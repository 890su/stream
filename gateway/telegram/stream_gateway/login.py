"""One-time login of a Telegram account (CONCEPT.md §8.2). The owner types the phone number, the code from
Telegram and the two-step password; nothing is printed back. The session stays in STATE_DIR on the server.

    docker compose run --rm -it tg-by login
"""
from __future__ import annotations

import asyncio
import getpass
import os
from pathlib import Path

from telethon import utils

from .main import client_for


async def login() -> None:
    account = os.environ["TG_ACCOUNT"]
    if not os.environ.get("TG_API_ID") or not os.environ.get("TG_API_HASH"):
        raise SystemExit("Нет TG_API_ID / TG_API_HASH в /srv/stream/.env — см. deploy/TELEGRAM.md")
    state_dir = Path(os.environ.get("STATE_DIR", "/state"))
    client = client_for(state_dir, account)
    await client.start(
        phone=lambda: input(f"Номер телефона аккаунта {account.upper()} (+…): "),
        code_callback=lambda: input("Код из Telegram: "),
        password=lambda: getpass.getpass("Пароль двухэтапной проверки (если есть): "),
    )
    me = await client.get_me()
    await client.disconnect()
    session = state_dir / f"{account}.session"
    if session.exists():
        session.chmod(0o600)
    print(f"Вход выполнен: {utils.get_display_name(me)}. Шлюз подхватит сессию в течение 5 минут.")


if __name__ == "__main__":
    asyncio.run(login())
