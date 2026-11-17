"""Telegram account gateway (CONCEPT.md §8.2, docs/plans/2026-11-17-p11-telegram.md).

One process per account. Reads tracked chats into Stream, catches up after downtime, sends approved replies,
reports a pulse. Blind (rule 6): never reads the feed and never calls AI.
"""
from __future__ import annotations

import asyncio
import logging
import os
import socket
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from telethon import TelegramClient, errors, events, utils
from telethon.tl import functions, types

from . import logic, tg
from .api import Stream, StreamError
from .state import State

VERSION = "0.1.0"
BATCH = 20
NETWORK = (urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout)
log = logging.getLogger("gateway")


def client_for(state_dir: Path, account: str) -> TelegramClient:
    return TelegramClient(
        str(state_dir / account), int(os.environ.get("TG_API_ID") or 0), os.environ.get("TG_API_HASH", ""),
        device_model="Stream gateway", system_version="Linux", app_version=VERSION, flood_sleep_threshold=120,
    )


class Gateway:
    def __init__(self) -> None:
        self.account = os.environ["TG_ACCOUNT"]
        self.state_dir = Path(os.environ.get("STATE_DIR", "/state"))
        self.stream = Stream(os.environ.get("STREAM_URL", "http://stream:3790"), self.account, os.environ["STREAM_GATEWAY_TOKEN"])
        self.state = State(self.state_dir / "pointers.json")
        self.client: TelegramClient | None = None  # created once api_id / api_hash are set
        self.config: dict = {}
        self.tracked: dict[str, logic.Chat] = {}
        self.folder: set[str] = set()
        self.health: tuple[str, str | None] | None = None  # unknown until the first session attempt
        self.health_changed = asyncio.Event()
        self.writing = asyncio.Lock()  # one writer to Stream, so pointers move in order
        self.sending = asyncio.Lock()  # an own message waits until its send is reported (echo check)
        self.albums: dict[int, int] = {}
        self.wake = asyncio.Event()

    def set_health(self, state: str, detail: str | None) -> None:
        if self.health != (state, detail):
            self.health = (state, detail)
            self.health_changed.set()  # report a change at once, not at the next pulse

    # ---- Stream side ----

    async def call(self, fn, *args):
        """A Stream call that waits out network trouble and server errors (5xx); 4xx is raised."""
        delay = 5
        while True:
            try:
                return await asyncio.to_thread(fn, *args)
            except StreamError as error:
                if error.status < 500:
                    raise
                log.warning("Stream %s, retry in %ss", error.status, delay)
            except NETWORK as error:
                log.warning("Stream unreachable (%s), retry in %ss", type(error).__name__, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)

    async def post(self, items: list[dict]) -> None:
        for start in range(0, len(items), BATCH):
            batch = items[start:start + BATCH]
            try:
                results = await self.call(self.stream.messages, batch)
            except StreamError as error:
                if len(batch) > 1:  # find the one bad message, keep the rest
                    for item in batch:
                        await self.post([item])
                    continue
                log.warning("message %s rejected: %s", batch[0].get("message_id"), error)
                results = [{"message_id": batch[0].get("message_id"), "status": "skipped"}]
            for item, result in zip(batch, results):
                if "edit_date" not in item:
                    self.state.advance(item["chat_id"], int(result["message_id"]))

    async def write(self, chat: logic.Chat, messages: list) -> None:
        async with self.writing:
            items = []
            for message in messages:
                item = await tg.body(self.client, self.stream, message, chat, self.config, self.albums)
                if item is None:
                    self.state.advance(chat.id, message.id)
                    continue
                item.pop("_edited", None)
                items.append(item)
            await self.post(items)

    # ---- Telegram side ----

    async def reconcile(self) -> None:
        """Re-read config, folder and dialogs; fetch what each tracked chat is missing."""
        self.config = await self.call(self.stream.config)
        self.folder = await tg.folder_peer_ids(self.client, self.config["folder"])
        chats = [tg.chat_from_dialog(dialog) async for dialog in self.client.iter_dialogs()]
        self.tracked = logic.tracked(chats, self.folder, set(self.config["excluded"]))
        self.state.keep_only(set(self.tracked))
        since = logic.today_start(self.config["timezone"], datetime.now(timezone.utc))
        limit = self.config["backfill_max_per_chat"]
        for chat in list(self.tracked.values()):
            fetch = logic.plan(chat, self.state.pointer(chat.id), since)
            if fetch.mode == "mark":
                self.state.advance(chat.id, chat.last_id)
            elif fetch.mode == "today":
                await self.write(chat, [m async for m in self.client.iter_messages(int(chat.id), offset_date=since, reverse=True, limit=limit)])
            elif fetch.mode == "after":
                await self.write(chat, [m async for m in self.client.iter_messages(int(chat.id), min_id=fetch.value, reverse=True, limit=1000)])
        log.info("tracking %d chats (%d groups)", len(self.tracked), sum(c.kind == "group" for c in self.tracked.values()))

    async def chat_for(self, event) -> logic.Chat | None:
        chat_id = str(event.chat_id)
        if chat_id in self.tracked:
            return self.tracked[chat_id]
        # A person writing for the first time is tracked at once; groups only through the folder.
        if chat_id in set(self.config.get("excluded", [])) or not event.is_private:
            return None
        entity = await event.get_chat()
        kind = logic.chat_kind(is_user=isinstance(entity, types.User), is_bot=bool(getattr(entity, "bot", False)),
                               is_self=bool(getattr(entity, "is_self", False)), is_group=False, peer_id=chat_id)
        if kind != "user":
            return None
        chat = logic.Chat(chat_id, kind, utils.get_display_name(entity) or "", event.message.id, event.message.date)
        self.tracked[chat_id] = chat
        return chat

    async def on_message(self, event) -> None:
        chat = await self.chat_for(event)
        if chat is None:
            return
        if event.message.out:
            async with self.sending:
                pass
        await self.write(chat, [event.message])

    async def on_edit(self, event) -> None:
        chat = self.tracked.get(str(event.chat_id))
        message = event.message
        if chat is None or not message.edit_date or message.edit_hide:
            return
        item = {"chat_id": chat.id, "message_id": message.id, "date": logic.iso(message.date), "out": bool(message.out),
                "text": message.message or "", "edit_date": logic.iso(message.edit_date)}
        async with self.writing:
            await self.post([item])

    async def on_folders(self, _update) -> None:
        self.wake.set()  # the folder changed: the next config tick re-reads chats

    async def send(self, action: dict) -> None:
        params = action["params"]
        async with self.sending:
            try:
                peer = await self.client.get_input_entity(int(params["chat_id"]))
                reply = params.get("reply_to_message_id")
                request = functions.messages.SendMessageRequest(
                    peer=peer, message=params["text"], random_id=logic.random_id(action["id"]),
                    reply_to=types.InputReplyToMessage(reply_to_msg_id=reply) if reply else None,
                )
                result = await self.client(request)
            except errors.RandomIdDuplicateError:
                await self.call(self.stream.result, action["id"], "done")
                return
            except errors.RPCError as error:
                await self.call(self.stream.result, action["id"], "failed", None, f"{type(error).__name__}: {error}"[:300])
                return
            except ValueError as error:  # unknown peer
                await self.call(self.stream.result, action["id"], "failed", None, f"Чат не найден: {error}"[:300])
                return
            message_id = getattr(result, "id", None)
            for update in getattr(result, "updates", []):
                if isinstance(update, types.UpdateMessageID) and update.random_id == request.random_id:
                    message_id = update.id
            await self.call(self.stream.result, action["id"], "done", message_id)

    # ---- loops ----

    async def actions_loop(self) -> None:
        while True:
            actions = await self.call(self.stream.actions, self.config.get("actions_wait_s", 25))
            for action in actions:
                if action["operation"] == "send_message":
                    await self.send(action)

    async def config_loop(self) -> None:
        tick = 0
        while True:
            await asyncio.sleep(self.config.get("config_poll_s", 60))
            tick += 1
            config = await self.call(self.stream.config)
            if set(config["excluded"]) != set(self.config.get("excluded", [])) or tick % 10 == 0 or self.wake.is_set():
                self.wake.clear()
                await self.reconcile()

    async def pulse_loop(self) -> None:
        while True:
            self.health_changed.clear()
            if self.health is not None:
                groups = sum(chat.kind == "group" for chat in self.tracked.values())
                info = {"chats": len(self.tracked) - groups, "groups": groups, "excluded": len(self.config.get("excluded", [])), "version": VERSION}
                try:
                    await asyncio.to_thread(self.stream.pulse, self.health[0], self.health[1], info)
                except (StreamError, *NETWORK) as error:
                    log.warning("pulse failed: %s", error)
            try:
                await asyncio.wait_for(self.health_changed.wait(), self.config.get("pulse_every_s", 60))
            except TimeoutError:
                pass

    async def session(self) -> None:
        if not os.environ.get("TG_API_ID") or not os.environ.get("TG_API_HASH"):
            # Not configured yet: report it and wait; the owner adds the keys and restarts (deploy/TELEGRAM.md).
            self.set_health("login_required", "нет TG_API_ID и TG_API_HASH в /srv/stream/.env — см. deploy/TELEGRAM.md")
            await asyncio.sleep(3600)
            return
        if self.client is None:
            self.client = client_for(self.state_dir, self.account)
        await self.client.connect()
        if not await self.client.is_user_authorized():
            self.set_health("login_required", "войдите: docker compose run --rm -it tg-%s login" % self.account)
            await self.client.disconnect()
            await asyncio.sleep(300)
            return
        self.client.add_event_handler(self.on_message, events.NewMessage())
        self.client.add_event_handler(self.on_edit, events.MessageEdited())
        self.client.add_event_handler(self.on_folders, events.Raw((types.UpdateDialogFilter, types.UpdateDialogFilters)))
        await self.reconcile()
        self.set_health("ok", None)
        tasks = [asyncio.create_task(self.actions_loop()), asyncio.create_task(self.config_loop())]
        try:
            await self.client.run_until_disconnected()
        finally:
            for task in tasks:
                task.cancel()
            self.client.remove_event_handler(self.on_message)
            self.client.remove_event_handler(self.on_edit)
            self.client.remove_event_handler(self.on_folders)

    async def run(self) -> None:
        pulse = asyncio.create_task(self.pulse_loop())
        delay = 10
        try:
            while True:
                try:
                    await self.session()
                    delay = 10
                except (errors.AuthKeyUnregisteredError, errors.SessionRevokedError, errors.UserDeactivatedError):
                    self.set_health("login_required", "сессия отозвана — войдите заново")
                    await asyncio.sleep(300)
                except Exception as error:  # noqa: BLE001 — keep the gateway alive, report it
                    log.exception("session failed")
                    self.set_health("error", f"{type(error).__name__}"[:300])
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, 300)
        finally:
            pulse.cancel()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("telethon").setLevel(logging.WARNING)
    asyncio.run(Gateway().run())


if __name__ == "__main__":
    main()
