"""@fileoverview source-based 分块规划器单元测试

覆盖迁移服务专用的按源分片策略。
"""

from __future__ import annotations

from app.shared.services.ai.agent.planner import (
    build_source_chunk_plan,
    source_plan_to_dict,
)


def _make_intents(count: int, token_each: int = 30) -> list[dict]:
    """构造意图列表，每个 intent 长度约为 token_each * 3。"""
    repeat = "a" * (token_each * 3)
    return [{"name": f"source_{i + 1}", "intent": repeat} for i in range(count)]


def _make_intent_with_tokens(name: str, tokens: int) -> dict:
    """构造指定估算 token 数的意图。"""
    return {"name": name, "intent": "x" * (tokens * 3)}


class TestBuildSourceChunkPlan:
    """按源分块计划测试。"""

    def test_empty_intents_returns_single_strategy(self):
        """空输入返回 single 策略且 chunks 为空。"""
        plan = build_source_chunk_plan([], max_sources_per_chunk=5, max_tokens_per_chunk=8000)
        assert plan.strategy == "single"
        assert plan.chunks == []
        assert "无来源" in plan.reason

    def test_single_degenerate_within_limits(self):
        """少来源且 token 在预算内退化为 single。"""
        intents = _make_intents(3, token_each=100)
        plan = build_source_chunk_plan(intents, max_sources_per_chunk=5, max_tokens_per_chunk=8000)

        assert plan.strategy == "single"
        assert len(plan.chunks) == 1
        assert plan.chunks[0].chunk_id == "source_single"
        assert plan.chunks[0].source_indices == [0, 1, 2]
        assert plan.chunks[0].source_names == ["source_1", "source_2", "source_3"]
        assert "单次处理" in plan.chunks[0].reason

    def test_by_source_when_exceeds_source_count(self):
        """来源数超过阈值时按源分组。"""
        intents = _make_intents(12, token_each=10)
        plan = build_source_chunk_plan(intents, max_sources_per_chunk=5, max_tokens_per_chunk=8000)

        assert plan.strategy == "by_source"
        assert len(plan.chunks) == 3
        assert [len(c.source_indices) for c in plan.chunks] == [5, 5, 2]
        assert plan.chunks[0].chunk_id == "source_chunk_1"
        assert plan.chunks[1].chunk_id == "source_chunk_2"
        assert plan.chunks[2].chunk_id == "source_chunk_3"
        assert plan.chunks[0].source_indices == list(range(5))
        assert plan.chunks[1].source_indices == list(range(5, 10))
        assert plan.chunks[2].source_indices == list(range(10, 12))

    def test_by_source_when_exceeds_token_budget(self):
        """单意图超长导致按 token 预算拆分。"""
        intents = [
            _make_intent_with_tokens("short_1", 100),
            _make_intent_with_tokens("huge", 5000),
            _make_intent_with_tokens("short_2", 100),
        ]
        plan = build_source_chunk_plan(intents, max_sources_per_chunk=5, max_tokens_per_chunk=3000)

        assert plan.strategy == "by_source"
        # huge 独占一个分片
        assert len(plan.chunks) == 3
        assert plan.chunks[0].source_names == ["short_1"]
        assert plan.chunks[1].source_names == ["huge"]
        assert plan.chunks[2].source_names == ["short_2"]

    def test_reason_contains_summary(self):
        """reason 应包含来源总数与分片数摘要。"""
        intents = _make_intents(7, token_each=10)
        plan = build_source_chunk_plan(intents, max_sources_per_chunk=5, max_tokens_per_chunk=8000)

        assert plan.strategy == "by_source"
        assert len(plan.chunks) == 2
        assert "7 个来源" in plan.reason
        assert "2 个分片" in plan.reason

    def test_source_plan_to_dict_roundtrip(self):
        """source_plan_to_dict 可正确序列化计划。"""
        intents = _make_intents(2, token_each=10)
        plan = build_source_chunk_plan(intents, max_sources_per_chunk=5, max_tokens_per_chunk=8000)
        data = source_plan_to_dict(plan)

        assert data["strategy"] == "single"
        assert data["reason"] == plan.reason
        assert len(data["chunks"]) == 1
        assert data["chunks"][0]["chunk_id"] == "source_single"
        assert data["chunks"][0]["source_names"] == ["source_1", "source_2"]
        assert data["chunks"][0]["source_indices"] == [0, 1]
        assert "reason" in data["chunks"][0]

    def test_missing_name_falls_back_to_generated(self):
        """意图缺少 name 字段时使用默认名称。"""
        intents = [{"intent": "aaa"}, {"intent": "bbb"}]
        plan = build_source_chunk_plan(intents, max_sources_per_chunk=5, max_tokens_per_chunk=8000)

        assert plan.chunks[0].source_names == ["source_1", "source_2"]
