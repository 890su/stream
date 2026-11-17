"""Stream's gateway endpoints (/api/gateway/telegram/<account>/*) over plain HTTP, no dependencies.

Calls are blocking; the gateway runs them in a thread (asyncio.to_thread).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request


class StreamError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"{status}: {message}")
        self.status = status


class Stream:
    def __init__(self, base_url: str, account: str, token: str):
        self._base = f"{base_url.rstrip('/')}/api/gateway/telegram/{account}/"
        self._token = token

    def _call(self, method: str, path: str, body: bytes | None = None, content_type: str = "application/json", timeout: float = 30):
        request = urllib.request.Request(self._base + path, data=body, method=method)
        request.add_header("Authorization", f"Bearer {self._token}")
        if body is not None:
            request.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read()).get("error", "")
            except Exception:  # noqa: BLE001 — any unreadable body
                message = ""
            raise StreamError(error.code, message) from None

    def config(self) -> dict:
        return self._call("GET", "config")

    def messages(self, items: list[dict]) -> list[dict]:
        return self._call("POST", "messages", json.dumps({"messages": items}).encode())["results"]

    def media(self, sha256: str, mime: str, data: bytes) -> None:
        self._call("PUT", f"media/{sha256}", data, mime, timeout=120)

    def actions(self, wait: int) -> list[dict]:
        return self._call("GET", f"actions?wait={wait}", timeout=wait + 15)["actions"]

    def result(self, action_id: str, status: str, message_id: int | None = None, error: str | None = None) -> None:
        body = {"status": status}
        if message_id:
            body["message_id"] = message_id
        if error:
            body["error"] = error
        self._call("POST", f"actions/{action_id}/result", json.dumps(body).encode())

    def pulse(self, state: str, detail: str | None, info: dict) -> None:
        self._call("POST", "pulse", json.dumps({"state": state, "detail": detail, "info": info}).encode())
