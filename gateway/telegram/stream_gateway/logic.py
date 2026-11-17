"""Pure decisions of the Telegram gateway (CONCEPT.md §8.2). No network, no Telethon: tested in tests/.

Which chats are tracked, what "today" means, what to fetch for a chat, how a message's media is handled.
"""
from __future__ import annotations

import fnmatch
import hashlib
from dataclasses import dataclass
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

SERVICE_USER_ID = "777000"  # Telegram's own chat with login codes: never written.


@dataclass(frozen=True)
class Chat:
    id: str  # marked peer id as text: users > 0, small groups < 0, supergroups -100…
    kind: str  # user | bot | self | service | group | channel
    title: str
    last_id: int  # newest message id in the chat (0 when empty)
    last_date: datetime | None


def chat_kind(*, is_user: bool, is_bot: bool, is_self: bool, is_group: bool, peer_id: str) -> str:
    if is_user:
        if is_self:
            return "self"
        if peer_id == SERVICE_USER_ID:
            return "service"
        return "bot" if is_bot else "user"
    return "group" if is_group else "channel"


def tracked(chats: list[Chat], folder_ids: set[str], excluded: set[str]) -> dict[str, Chat]:
    """Personal chats with people — all, minus «Не отслеживать»; groups — only from the folder.
    Channels, bots, Saved Messages and the service chat — never."""
    result: dict[str, Chat] = {}
    for chat in chats:
        if chat.id in excluded:
            continue
        if chat.kind == "user" or (chat.kind == "group" and chat.id in folder_ids):
            result[chat.id] = chat
    return result


def today_start(timezone_name: str, now: datetime) -> datetime:
    """Local midnight of the account's time zone, in UTC."""
    zone = ZoneInfo(timezone_name)
    local = now.astimezone(zone)
    return datetime.combine(local.date(), time(0), zone).astimezone(timezone.utc)


@dataclass(frozen=True)
class Fetch:
    mode: str  # skip | mark | today | after
    value: int | datetime | None = None


def plan(chat: Chat, pointer: int | None, since: datetime) -> Fetch:
    """What to read for one tracked chat.

    No pointer — the chat has just started being tracked: today's messages, or nothing (only remember
    the newest id) when nothing came today. A pointer — catch up on everything after it."""
    if pointer is None:
        if chat.last_id and chat.last_date and chat.last_date >= since:
            return Fetch("today", since)
        return Fetch("mark", chat.last_id)
    if chat.last_id > pointer:
        return Fetch("after", pointer)
    return Fetch("skip")


def random_id(action_id: str) -> int:
    """Telegram's random_id for a send: the same action never produces a second message."""
    return int.from_bytes(hashlib.sha256(action_id.encode()).digest()[:8], "big", signed=True)


def mime_allowed(mime: str, patterns: list[str]) -> bool:
    base = mime.split(";")[0].strip().lower()
    return any(fnmatch.fnmatchcase(base, pattern) for pattern in patterns)


def media_problem(mime: str, size: int | None, patterns: list[str], max_bytes: int) -> str | None:
    """None when the file is downloaded; otherwise the reason it is only noted."""
    if not mime_allowed(mime, patterns):
        return "unsupported"
    if size is not None and size > max_bytes:
        return "too_large"
    return None


def message_kind(mime: str | None, *, voice: bool, photo: bool) -> str:
    if photo or (mime or "").startswith("image/"):
        return "photo"
    if voice:
        return "voice"
    return "file" if mime else "text"


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
