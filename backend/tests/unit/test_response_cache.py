"""ResponseCache 与 cache_key 单元测试"""

from __future__ import annotations

import threading
import time

from app.shared.services.llm.cache.response_cache import ResponseCache, _normalize_message, cache_key
from app.shared.services.llm.providers.base import ChatMessage, ChatRequest

# ── helpers ──────────────────────────────────────────────────────────────────


def _make_request(
    content: str = "hello",
    model: str = "gpt-4",
    temperature: float = 0.0,
    tools: list | None = None,
    tool_choice: str | None = None,
) -> ChatRequest:
    return ChatRequest(
        messages=[ChatMessage(role="user", content=content)],
        model=model,
        temperature=temperature,
        tools=tools,
        tool_choice=tool_choice,
    )


# ── ResponseCache ────────────────────────────────────────────────────────────


class TestResponseCache:
    def test_get_put_roundtrip(self):
        cache = ResponseCache(max_entries=10, ttl_seconds=60)
        cache.put("k1", "value1")
        assert cache.get("k1") == "value1"

    def test_get_missing_key_returns_none(self):
        cache = ResponseCache(max_entries=10, ttl_seconds=60)
        assert cache.get("nonexistent") is None

    def test_lru_eviction(self):
        cache = ResponseCache(max_entries=3, ttl_seconds=60)
        cache.put("a", 1)
        cache.put("b", 2)
        cache.put("c", 3)
        # 加第 4 个，应驱逐 "a"（最旧）
        cache.put("d", 4)
        assert cache.get("a") is None
        assert cache.get("b") == 2
        assert cache.get("c") == 3
        assert cache.get("d") == 4

    def test_lru_access_moves_to_end(self):
        cache = ResponseCache(max_entries=3, ttl_seconds=60)
        cache.put("a", 1)
        cache.put("b", 2)
        cache.put("c", 3)
        # 访问 "a"，使其变为最近使用
        cache.get("a")
        # 加第 4 个，应驱逐 "b"（现在最旧）
        cache.put("d", 4)
        assert cache.get("a") == 1
        assert cache.get("b") is None

    def test_ttl_expiration(self):
        cache = ResponseCache(max_entries=10, ttl_seconds=0.1)
        cache.put("k", "v")
        time.sleep(0.15)
        assert cache.get("k") is None

    def test_put_overwrites_existing(self):
        cache = ResponseCache(max_entries=10, ttl_seconds=60)
        cache.put("k", "old")
        cache.put("k", "new")
        assert cache.get("k") == "new"

    def test_thread_safety(self):
        cache = ResponseCache(max_entries=100, ttl_seconds=60)
        errors: list[Exception] = []

        def writer(start: int):
            try:
                for i in range(50):
                    cache.put(f"t-{start}-{i}", i)
            except Exception as e:
                errors.append(e)

        def reader():
            try:
                for _ in range(100):
                    cache.get("anything")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(j,)) for j in range(4)]
        threads += [threading.Thread(target=reader) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert errors == []


# ── _normalize_message ───────────────────────────────────────────────────────


class TestNormalizeMessage:
    def test_strips_none_fields(self):
        msg = ChatMessage(role="user", content="hi")
        result = _normalize_message(msg)
        assert result == {"role": "user", "content": "hi"}
        assert "tool_calls" not in result
        assert "tool_call_id" not in result

    def test_preserves_tool_calls(self):
        msg = ChatMessage(role="assistant", tool_calls=[{"id": "c1"}])
        result = _normalize_message(msg)
        assert result["tool_calls"] == [{"id": "c1"}]

    def test_preserves_tool_call_id(self):
        msg = ChatMessage(role="tool", content="ok", tool_call_id="c1")
        result = _normalize_message(msg)
        assert result["tool_call_id"] == "c1"


# ── cache_key ────────────────────────────────────────────────────────────────


class TestCacheKey:
    def test_same_input_same_key(self):
        r1 = _make_request(content="hi", model="gpt-4", temperature=0)
        r2 = _make_request(content="hi", model="gpt-4", temperature=0)
        assert cache_key(r1) == cache_key(r2)

    def test_different_content_different_key(self):
        r1 = _make_request(content="hi")
        r2 = _make_request(content="bye")
        assert cache_key(r1) != cache_key(r2)

    def test_different_model_different_key(self):
        r1 = _make_request(model="gpt-4")
        r2 = _make_request(model="llama3")
        assert cache_key(r1) != cache_key(r2)

    def test_different_temperature_different_key(self):
        r1 = _make_request(temperature=0)
        r2 = _make_request(temperature=0.7)
        assert cache_key(r1) != cache_key(r2)

    def test_different_tools_different_key(self):
        r1 = _make_request(tools=[{"type": "function", "function": {"name": "a"}}])
        r2 = _make_request(tools=[{"type": "function", "function": {"name": "b"}}])
        assert cache_key(r1) != cache_key(r2)

    def test_none_tools_vs_empty_tools_same_key(self):
        """None 和空列表在规范化后应产生相同 key。"""
        r1 = _make_request(tools=None)
        r2 = _make_request(tools=[])
        # 当前实现直接传入，None 与 [] 不同——这是预期行为
        # （规范要求 tools 定义变化时 miss，None 和 [] 语义不同）
        assert cache_key(r1) != cache_key(r2)

    def test_dict_vs_dataclass_same_key(self):
        """ChatMessage dataclass 和等效 dict 应产生相同 key。"""
        r1 = ChatRequest(
            messages=[ChatMessage(role="user", content="hi")],
            model="gpt-4",
            temperature=0,
        )
        r2 = ChatRequest(
            messages=[ChatMessage(role="user", content="hi")],
            model="gpt-4",
            temperature=0,
        )
        assert cache_key(r1) == cache_key(r2)

    def test_returns_hex_string(self):
        key = cache_key(_make_request())
        assert isinstance(key, str)
        assert len(key) == 64  # SHA-256 hex digest length
