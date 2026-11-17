"""Local gateway state: per chat, the newest message id the server has accepted.

A pointer moves only after Stream answered; a chat that stops being tracked loses its pointer, so when it is
tracked again it starts from today (CONCEPT.md §8.2) instead of pulling everything since it was switched off.
"""
from __future__ import annotations

import json
import os
from pathlib import Path


class State:
    def __init__(self, path: Path):
        self._path = path
        self._pointers: dict[str, int] = {}
        if path.exists():
            self._pointers = {str(k): int(v) for k, v in json.loads(path.read_text("utf-8")).get("pointers", {}).items()}

    def pointer(self, chat_id: str) -> int | None:
        return self._pointers.get(chat_id)

    def advance(self, chat_id: str, message_id: int) -> None:
        if message_id > self._pointers.get(chat_id, 0):
            self._pointers[chat_id] = message_id
            self._save()

    def keep_only(self, chat_ids: set[str]) -> None:
        dropped = set(self._pointers) - chat_ids
        if dropped:
            for chat_id in dropped:
                del self._pointers[chat_id]
            self._save()

    def _save(self) -> None:
        temporary = self._path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"pointers": self._pointers}), "utf-8")
        os.replace(temporary, self._path)
