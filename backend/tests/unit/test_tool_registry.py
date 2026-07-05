"""@fileoverview ToolRegistry 入参校验测试（P1-1）

覆盖 register 的 args_model 参数 + execute 入口的 Pydantic 校验行为：
- 必填字段缺失 → 结构化错误回灌，handler 不被调用
- 类型错误 → 同上
- 多余字段 → 通过（extra="allow"，不拒合法变体）
- 校验通过 → 正常调用 handler，且 handler 收到原始 arguments（不被 model_dump 改写）
- 未注册 args_model 的工具 → 保持原透传行为（向后兼容）
"""

from __future__ import annotations

import asyncio

import pytest
from pydantic import BaseModel, Field

from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.ai.agent.types import ToolCall


class _SampleArgs(BaseModel):
    """测试用入参模型：name 必填，count 可选。"""

    name: str = Field(..., description="名称")
    count: int | None = Field(default=None, description="数量")


@pytest.mark.asyncio
async def test_missing_required_field_returns_structured_error():
    """必填字段缺失 → 返回带字段名的错误，handler 不被调用。"""
    called = False

    def handler(args):  # noqa: ARG001
        nonlocal called
        called = True
        return {"success": True}

    registry = ToolRegistry()
    registry.register(
        name="sample",
        description="d",
        parameters={"type": "object"},
        handler=handler,
        args_model=_SampleArgs,
    )

    result = await registry.execute(ToolCall(id="c1", name="sample", arguments={}))

    assert result.success is False
    assert not called, "校验失败时不应调用 handler"
    assert "参数校验失败" in (result.error or "")
    assert "name" in (result.error or "")


@pytest.mark.asyncio
async def test_wrong_type_returns_structured_error():
    """类型错误（count 传字符串）→ 返回类型相关错误，handler 不被调用。"""
    called = False

    def handler(args):  # noqa: ARG001
        nonlocal called
        called = True
        return {"success": True}

    registry = ToolRegistry()
    registry.register(
        name="sample",
        description="d",
        parameters={"type": "object"},
        handler=handler,
        args_model=_SampleArgs,
    )

    result = await registry.execute(ToolCall(id="c1", name="sample", arguments={"name": "ok", "count": "not-an-int"}))

    assert result.success is False
    assert not called
    assert "count" in (result.error or "")


@pytest.mark.asyncio
async def test_extra_fields_allowed():
    """多余字段 → 校验通过（extra="allow"），handler 正常被调用。

    LLM 偶尔会带额外字段（变体参数），不应为此拒绝合法调用。
    """
    received: dict = {}

    def handler(args):
        received.update(args)
        return {"success": True}

    registry = ToolRegistry()
    registry.register(
        name="sample",
        description="d",
        parameters={"type": "object"},
        handler=handler,
        args_model=_SampleArgs,  # _SampleArgs 未显式设 extra，用默认行为验证
    )

    # _SampleArgs 用默认 extra（ignore），额外字段不触发错误
    result = await registry.execute(ToolCall(id="c1", name="sample", arguments={"name": "ok", "extra_field": "x"}))

    assert result.success is True


@pytest.mark.asyncio
async def test_valid_args_call_handler_with_original_arguments():
    """校验通过 → handler 收到原始 arguments（不被 model_dump 改写）。

    关键：apply_actions 的 actions 是 list[dict[str, Any]]，model_dump 可能有副作用，
    所以校验通过后必须传原始 call.arguments，而非规范化后的 dump 结果。
    """
    received: dict = {}

    def handler(args):
        received.update(args)
        return {"success": True}

    registry = ToolRegistry()
    registry.register(
        name="sample",
        description="d",
        parameters={"type": "object"},
        handler=handler,
        args_model=_SampleArgs,
    )

    await registry.execute(ToolCall(id="c1", name="sample", arguments={"name": "ok", "count": 5}))

    # handler 收到的应与传入一致（原始 dict 引用语义）
    assert received == {"name": "ok", "count": 5}


@pytest.mark.asyncio
async def test_no_args_model_falls_back_to_passthrough():
    """未注册 args_model 的工具 → 保持原透传行为，向后兼容。"""
    received: dict = {}

    def handler(args):
        received.update(args)
        return {"success": True}

    registry = ToolRegistry()
    registry.register(
        name="legacy",
        description="d",
        parameters={"type": "object"},
        handler=handler,
        # 不传 args_model
    )

    # 即使缺必填字段也透传（旧工具的契约）
    result = await registry.execute(ToolCall(id="c1", name="legacy", arguments={}))

    assert result.success is True
    assert received == {}


@pytest.mark.asyncio
async def test_apply_actions_empty_actions_rejected():
    """apply_actions 的 actions 空数组 → 被 field_validator 拦截（OpenAI schema required 漏过的场景）。"""
    from app.shared.services.ai.agent.chat_tools.schemas import ApplyActionsArgs

    called = False

    def handler(args):  # noqa: ARG001
        nonlocal called
        called = True
        return {"success": True}

    registry = ToolRegistry()
    registry.register(
        name="apply_actions",
        description="d",
        parameters={"type": "object"},
        handler=handler,
        args_model=ApplyActionsArgs,
    )

    result = await registry.execute(ToolCall(id="c1", name="apply_actions", arguments={"actions": []}))

    assert result.success is False
    assert not called
    assert "actions" in (result.error or "")


# =============================================================================
# P2-3 execute_many 分流测试（写盘串行 / 只读并发 / 顺序对齐）
# =============================================================================


async def _tracking_handler(records: list, label: str, delay: float = 0.05):
    """记录进入/退出时间戳的测试 handler，用于验证执行区间是否重叠。

    每个 handler sleep(delay)，让并发/串行的时序差异可观测。
    records 形如 [{"label": "w1", "start": t, "end": t}, ...]
    """
    start = asyncio.get_event_loop().time()
    records.append({"label": label, "start": start, "phase": "enter"})
    await asyncio.sleep(delay)
    end = asyncio.get_event_loop().time()
    records.append({"label": label, "start": start, "end": end, "phase": "exit"})
    return {"success": True, "label": label}


def _intervals_overlap(a: dict, b: dict) -> bool:
    """判断两个执行区间 [start, end] 是否重叠。"""
    return a["start"] < b["end"] and b["start"] < a["end"]


@pytest.mark.asyncio
async def test_write_tools_executed_serially():
    """同轮多个写盘工具（read_only=False）→ 串行执行，区间不重叠。"""
    records: list = []
    registry = ToolRegistry()
    registry.register(
        name="write_a",
        description="d",
        parameters={"type": "object"},
        handler=lambda args: _tracking_handler(records, "w1"),
        read_only=False,
    )
    registry.register(
        name="write_b",
        description="d",
        parameters={"type": "object"},
        handler=lambda args: _tracking_handler(records, "w2"),
        read_only=False,
    )

    calls = [
        ToolCall(id="c1", name="write_a", arguments={}),
        ToolCall(id="c2", name="write_b", arguments={}),
    ]
    results = await registry.execute_many(calls)

    # 顺序对齐
    assert [r.observation["label"] for r in results] == ["w1", "w2"]  # type: ignore[index]
    # 提取两个写盘工具的执行区间
    exits = [r for r in records if r.get("phase") == "exit"]
    assert len(exits) == 2
    assert not _intervals_overlap(exits[0], exits[1]), "写盘工具必须串行，区间不应重叠"


@pytest.mark.asyncio
async def test_read_only_tools_executed_concurrently():
    """同轮多个只读工具（read_only=True）→ 并发执行，区间重叠。"""
    records: list = []
    registry = ToolRegistry()
    registry.register(
        name="read_a",
        description="d",
        parameters={"type": "object"},
        handler=lambda args: _tracking_handler(records, "r1"),
        read_only=True,
    )
    registry.register(
        name="read_b",
        description="d",
        parameters={"type": "object"},
        handler=lambda args: _tracking_handler(records, "r2"),
        read_only=True,
    )

    calls = [
        ToolCall(id="c1", name="read_a", arguments={}),
        ToolCall(id="c2", name="read_b", arguments={}),
    ]
    results = await registry.execute_many(calls)

    # 顺序对齐
    assert [r.observation["label"] for r in results] == ["r1", "r2"]  # type: ignore[index]
    # 提取两个只读工具的执行区间，应重叠（并发）
    exits = [r for r in records if r.get("phase") == "exit"]
    assert len(exits) == 2
    assert _intervals_overlap(exits[0], exits[1]), "只读工具应并发执行，区间应重叠"


@pytest.mark.asyncio
async def test_mixed_tools_result_order_aligned():
    """混合（只读 + 写盘）→ 结果顺序与 calls 对齐。

    构造 calls 顺序为 [read, write, read, write]，验证 results 下标对应正确。
    """
    records: list = []
    registry = ToolRegistry()
    for name, ro in [("read_x", True), ("write_y", False), ("read_z", True), ("write_w", False)]:
        # 用闭包捕获当前 name，避免 lambda 延迟绑定
        registry.register(
            name=name,
            description="d",
            parameters={"type": "object"},
            handler=(lambda n: lambda args: _tracking_handler(records, n))(name),
            read_only=ro,
        )

    calls = [
        ToolCall(id="1", name="read_x", arguments={}),
        ToolCall(id="2", name="write_y", arguments={}),
        ToolCall(id="3", name="read_z", arguments={}),
        ToolCall(id="4", name="write_w", arguments={}),
    ]
    results = await registry.execute_many(calls)

    # 顺序严格对齐（关键契约：_collect_audit_trail 按下标取 tool_result）
    assert [r.observation["label"] for r in results] == ["read_x", "write_y", "read_z", "write_w"]  # type: ignore[index]
    # 全部成功
    assert all(r.success for r in results)


@pytest.mark.asyncio
async def test_default_read_only_is_false():
    """未显式声明 read_only 的工具 → 默认视为写盘（保守策略，串行执行）。"""
    records: list = []
    registry = ToolRegistry()
    registry.register(
        name="unknown_a",
        description="d",
        parameters={"type": "object"},
        handler=lambda args: _tracking_handler(records, "u1"),
        # 不传 read_only
    )
    registry.register(
        name="unknown_b",
        description="d",
        parameters={"type": "object"},
        handler=lambda args: _tracking_handler(records, "u2"),
        # 不传 read_only
    )

    calls = [
        ToolCall(id="c1", name="unknown_a", arguments={}),
        ToolCall(id="c2", name="unknown_b", arguments={}),
    ]
    await registry.execute_many(calls)

    exits = [r for r in records if r.get("phase") == "exit"]
    # 默认写盘 → 串行 → 不重叠
    assert not _intervals_overlap(exits[0], exits[1]), "未声明 read_only 应默认串行（保守）"
