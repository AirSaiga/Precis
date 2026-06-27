from __future__ import annotations

import hashlib
import json
import time
from collections import OrderedDict
from threading import Lock
from typing import Any

from app.shared.services.llm.providers.base import ChatMessage, ChatRequest


class ResponseCache:
    """LLM 响应缓存（LRU + TTL，线程安全）。"""

    def __init__(self, max_entries: int = 100, ttl_seconds: float = 3600):
        self._store: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._max = max_entries
        self._ttl = ttl_seconds
        self._lock = Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expire_at = entry
            if time.time() > expire_at:
                self._store.pop(key, None)
                return None
            self._store.move_to_end(key)
            return value

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = (value, time.time() + self._ttl)
            self._store.move_to_end(key)
            while len(self._store) > self._max:
                self._store.popitem(last=False)


def cache_key(req: ChatRequest) -> str:
    """规范化哈希请求，作为缓存键。"""
    payload = {
        "model": req.model,
        "temperature": req.temperature,
        "messages": [_normalize_message(m) for m in req.messages],
        "tools": req.tools,
        "tool_choice": req.tool_choice,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def _normalize_message(m: ChatMessage) -> dict:
    """将 ChatMessage 转为可哈希 dict，去除 None 字段。"""
    d: dict[str, Any] = {"role": m.role}
    if m.content is not None:
        d["content"] = m.content
    if m.tool_calls is not None:
        d["tool_calls"] = m.tool_calls
    if m.tool_call_id is not None:
        d["tool_call_id"] = m.tool_call_id
    return d
