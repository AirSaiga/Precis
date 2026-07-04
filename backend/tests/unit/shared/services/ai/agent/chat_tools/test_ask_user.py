"""AskUserTool 单元测试。

覆盖：
- 4 种 question_type happy path（mock controller.await_response）
- 参数校验（choice 缺 options / value 缺 value_type / 非法 question_type）
- 非流式 fail-closed（dry_run_enabled=False）
- ask_id 递增
- callback emit 时序（on_user_input_requested / on_user_responded）
- get_definition schema 正确性
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.shared.services.ai.agent.chat_tools.ask_user import AskCallbacks, AskUserTool


class TestAskUserToolValidation:
    """参数校验逻辑。"""

    @pytest.mark.asyncio
    async def test_invalid_question_type_returns_error(self) -> None:
        tool = AskUserTool(job_id="job-1", dry_run_enabled=True)
        result = await tool.run({"question_type": "bogus", "prompt": "x"})
        assert result["success"] is False
        assert result["answer"]["skipped"] is True
        assert result["answer"]["reason"] == "bad_args"

    @pytest.mark.asyncio
    async def test_choice_without_options_returns_error(self) -> None:
        tool = AskUserTool(job_id="job-1", dry_run_enabled=True)
        result = await tool.run({"question_type": "choice", "prompt": "选哪个?", "options": []})
        assert result["success"] is False
        assert "options" in result["error"]

    @pytest.mark.asyncio
    async def test_value_without_value_type_returns_error(self) -> None:
        tool = AskUserTool(job_id="job-1", dry_run_enabled=True)
        result = await tool.run({"question_type": "value", "prompt": "输入数字"})
        assert result["success"] is False
        assert "value_type" in result["error"]

    @pytest.mark.asyncio
    async def test_value_invalid_value_type_returns_error(self) -> None:
        tool = AskUserTool(job_id="job-1", dry_run_enabled=True)
        result = await tool.run({"question_type": "value", "prompt": "x", "value_type": "bogus"})
        assert result["success"] is False


class TestAskUserToolFailClosed:
    """非流式环境 fail-closed。"""

    @pytest.mark.asyncio
    async def test_dry_run_disabled_returns_unsupported(self) -> None:
        tool = AskUserTool(job_id="job-1", dry_run_enabled=False)
        result = await tool.run({"question_type": "free_text", "prompt": "x"})
        assert result["success"] is False
        assert result["unsupported"] is True
        assert result["answer"]["reason"] == "unsupported_env"


class TestAskUserToolHappyPath:
    """4 种 question_type happy path（mock controller）。"""

    @pytest.mark.asyncio
    async def test_free_text_gets_answer_back(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """free_text 正常流程：emit requested → 用户回答 → observation 回灌。"""
        requested_calls: list[dict] = []
        responded_calls: list[dict] = []
        callbacks = AskCallbacks(
            on_user_input_requested=lambda p: requested_calls.append(p),
            on_user_responded=lambda p: responded_calls.append(p),
        )
        tool = AskUserTool(job_id="job-1", ask_callbacks=callbacks, dry_run_enabled=True)
        _patch_ctrl_and_store(monkeypatch, {"answer": "用 A 方案"})

        result = await tool.run({"question_type": "free_text", "prompt": "选哪个方案?"})

        assert result["success"] is True
        assert result["answer"] == {"answer": "用 A 方案"}
        assert len(requested_calls) == 1
        assert requested_calls[0]["question_type"] == "free_text"
        assert requested_calls[0]["ask_id"] == "job-1#ask#1"
        assert len(responded_calls) == 1

    @pytest.mark.asyncio
    async def test_choice_multiple_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        tool = AskUserTool(job_id="job-2", dry_run_enabled=True)
        _patch_ctrl_and_store(monkeypatch, {"answer": ["a", "b"]})
        result = await tool.run(
            {
                "question_type": "choice",
                "prompt": "选列",
                "options": [{"label": "A", "value": "a"}, {"label": "B", "value": "b"}],
                "multiple": True,
            }
        )
        assert result["success"] is True
        assert result["answer"]["answer"] == ["a", "b"]

    @pytest.mark.asyncio
    async def test_value_integer_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        tool = AskUserTool(job_id="job-3", dry_run_enabled=True)
        _patch_ctrl_and_store(monkeypatch, {"answer": 42})
        result = await tool.run(
            {
                "question_type": "value",
                "prompt": "输入数字",
                "value_type": "integer",
            }
        )
        assert result["success"] is True
        assert result["answer"]["answer"] == 42

    @pytest.mark.asyncio
    async def test_confirm_yes_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        tool = AskUserTool(job_id="job-4", dry_run_enabled=True)
        _patch_ctrl_and_store(monkeypatch, {"answer": True})
        result = await tool.run({"question_type": "confirm", "prompt": "确认?"})
        assert result["success"] is True
        assert result["answer"]["answer"] is True

    @pytest.mark.asyncio
    async def test_skipped_response_propagated(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """用户跳过时 observation 含 skipped。"""
        tool = AskUserTool(job_id="job-5", dry_run_enabled=True)
        _patch_ctrl_and_store(monkeypatch, {"skipped": True, "reason": "user_skipped"})
        result = await tool.run({"question_type": "free_text", "prompt": "x"})
        assert result["success"] is True
        assert result["answer"]["skipped"] is True


class TestAskIdIncrement:
    """ask_id 每次调用递增。"""

    @pytest.mark.asyncio
    async def test_consecutive_calls_increment_seq(self, monkeypatch: pytest.MonkeyPatch) -> None:
        requested_calls: list[dict] = []
        callbacks = AskCallbacks(on_user_input_requested=lambda p: requested_calls.append(p))
        tool = AskUserTool(job_id="job-1", ask_callbacks=callbacks, dry_run_enabled=True)
        _patch_ctrl_and_store(monkeypatch, {"answer": "x"})

        await tool.run({"question_type": "free_text", "prompt": "1"})
        await tool.run({"question_type": "free_text", "prompt": "2"})

        # 两次调用的 ask_id 序列号递增
        assert requested_calls[0]["ask_id"] == "job-1#ask#1"
        assert requested_calls[1]["ask_id"] == "job-1#ask#2"


class TestGetDefinition:
    """get_definition 返回合法 OpenAI tool schema。"""

    def test_definition_has_required_fields(self) -> None:
        tool = AskUserTool(job_id="job-1")
        d = tool.get_definition()
        assert d["type"] == "function"
        assert d["function"]["name"] == "ask_user"
        params = d["function"]["parameters"]
        assert "question_type" in params["properties"]
        assert "prompt" in params["properties"]
        assert params["required"] == ["question_type", "prompt"]
        assert set(params["properties"]["question_type"]["enum"]) == {
            "free_text",
            "choice",
            "value",
            "confirm",
        }


# ---- helper ----


def _patch_ctrl_and_store(monkeypatch: pytest.MonkeyPatch, response: dict) -> None:
    """Patch InteractionController 和 store，使 await_response 返回指定 response。

    关键：patch 源模块 app.shared.services.ai.streaming.pending_interaction_store 的属性，
    这样 ask_user.py 内的 deferred import 会拿到 mock。
    """
    mock_ctrl = MagicMock()
    mock_ctrl.await_response = AsyncMock(return_value=response)
    mock_ctrl.is_resolved = True
    # patch 源模块的类，使 ask_user.run() 内 `from ...pending_interaction_store import InteractionController` 拿到 mock
    monkeypatch.setattr(
        "app.shared.services.ai.streaming.pending_interaction_store.InteractionController",
        lambda **kwargs: mock_ctrl,
    )
    mock_store = MagicMock()
    mock_store.put = MagicMock()
    mock_store.pop = MagicMock()
    monkeypatch.setattr(
        "app.shared.services.ai.streaming.pending_interaction_store.get_global_pending_interaction_store",
        lambda: mock_store,
    )
