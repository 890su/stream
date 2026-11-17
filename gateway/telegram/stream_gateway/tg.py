"""Telethon → Stream: dialogs as Chat, the Stream folder's peers, a message as a request body.

Everything Telegram-specific lives here; decisions are in logic.py.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging

from telethon import TelegramClient, utils
from telethon.tl import functions, types

from . import logic
from .api import Stream

log = logging.getLogger("gateway")


def chat_from_dialog(dialog) -> logic.Chat:
    entity = dialog.entity
    peer_id = str(dialog.id)
    is_user = isinstance(entity, types.User)
    kind = logic.chat_kind(
        is_user=is_user, is_bot=bool(is_user and entity.bot), is_self=bool(is_user and entity.is_self),
        is_group=bool(dialog.is_group), peer_id=peer_id,
    )
    message = dialog.message
    return logic.Chat(peer_id, kind, utils.get_display_name(entity) or "", message.id if message else 0, message.date if message else None)


async def folder_peer_ids(client: TelegramClient, title: str) -> set[str]:
    """Peers listed in the folder with this name (case-insensitive); pinned ones count too."""
    result = await client(functions.messages.GetDialogFiltersRequest())
    filters = getattr(result, "filters", result)
    ids: set[str] = set()
    for item in filters:
        if not isinstance(item, (types.DialogFilter, types.DialogFilterChatlist)):
            continue
        name = item.title.text if hasattr(item.title, "text") else str(item.title)
        if name.strip().lower() != title.strip().lower():
            continue
        for peer in [*item.pinned_peers, *item.include_peers]:
            try:
                ids.add(str(utils.get_peer_id(peer)))
            except (TypeError, ValueError):
                continue
    return ids


def _service_text(message) -> str | None:
    """Messages without text or a file that still carry something worth reading."""
    if message.sticker:
        alt = next((a.alt for a in message.sticker.attributes if isinstance(a, types.DocumentAttributeSticker)), "")
        return f"[стикер {alt}]".replace(" ]", "]")
    if isinstance(message.media, (types.MessageMediaGeo, types.MessageMediaGeoLive, types.MessageMediaVenue)):
        geo = message.media.geo
        title = getattr(message.media, "title", "") or ""
        return f"📍 {title} {geo.lat:.5f}, {geo.long:.5f}".replace("  ", " ")
    if isinstance(message.media, types.MessageMediaContact):
        name = " ".join(filter(None, [message.media.first_name, message.media.last_name]))
        return f"👤 {name} {message.media.phone_number}".strip()
    if isinstance(message.media, types.MessageMediaPoll):
        question = message.media.poll.question
        return f"📊 {question.text if hasattr(question, 'text') else question}"
    return None


async def _media(client: TelegramClient, stream: Stream, message, config: dict) -> tuple[str, list[dict], dict | None]:
    """(kind, media refs, media_skipped). Files are uploaded to Stream before the message."""
    file = message.file
    photo = bool(message.photo)
    if not file or message.sticker or _service_text(message):
        return "text", [], None
    mime = "image/jpeg" if photo else (file.mime_type or "application/octet-stream")
    kind = logic.message_kind(mime, voice=bool(message.voice), photo=photo)
    problem = logic.media_problem(mime, file.size, config["mime_types"], config["media_max_bytes"])
    if problem:
        return kind, [], {k: v for k, v in {"reason": problem, "mime": mime, "size_bytes": file.size, "name": file.name}.items() if v is not None}
    try:
        data = await client.download_media(message, file=bytes)
    except Exception as error:  # noqa: BLE001 — a lost file must not stop the chat
        log.warning("media download failed: %s", type(error).__name__)
        return kind, [], {"reason": "failed", "mime": mime}
    sha = hashlib.sha256(data).hexdigest()
    await asyncio.to_thread(stream.media, sha, mime, data)
    ref = {"media_id": sha, "mime": mime, "size_bytes": len(data)}
    if file.duration:
        ref["duration_s"] = file.duration
    return kind, [ref], None


async def body(client: TelegramClient, stream: Stream, message, chat: logic.Chat, config: dict, album_first: dict[int, int]) -> dict | None:
    """The request body for /messages, or None for service messages (joins, pins…)."""
    if isinstance(message, types.MessageService) or getattr(message, "action", None):
        return None
    item: dict = {
        "chat_id": chat.id, "chat_type": "group" if chat.kind == "group" else "private", "chat_title": chat.title,
        "message_id": message.id, "date": logic.iso(message.date), "out": bool(message.out),
    }
    sender = message.from_id or (None if message.out else message.peer_id)
    if sender is not None:
        item["from_id"] = str(utils.get_peer_id(sender))
    try:
        entity = await message.get_sender()
        if entity is not None:
            item["from_name"] = utils.get_display_name(entity)
    except Exception:  # noqa: BLE001 — the name is optional
        pass
    if message.reply_to and getattr(message.reply_to, "reply_to_msg_id", None):
        item["reply_to_message_id"] = message.reply_to.reply_to_msg_id
    forward = message.fwd_from
    if forward:
        item["forward"] = {"date": logic.iso(forward.date)}
        if forward.from_id:
            item["forward"]["from_id"] = str(utils.get_peer_id(forward.from_id))
        if forward.from_name:
            item["forward"]["from_name"] = forward.from_name
    if message.grouped_id:
        item["album_id"] = str(message.grouped_id)
        item["album_first"] = album_first.setdefault(message.grouped_id, message.id)
    if message.edit_date and not message.edit_hide:
        item["_edited"] = logic.iso(message.edit_date)  # used only by the live edit handler
    kind, media, skipped = await _media(client, stream, message, config)
    item["kind"] = kind
    item["text"] = message.message or _service_text(message) or ""
    if media:
        item["media"] = media
    if skipped:
        item["media_skipped"] = skipped
    return item
