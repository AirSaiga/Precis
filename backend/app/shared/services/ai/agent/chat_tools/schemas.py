"""@fileoverview chat 工具入参的 Pydantic 校验模型

P1-1：为每个 chat 工具定义入参模型，由 ToolRegistry 在 execute 入口做结构校验，
统一拦截"必填字段缺失/类型错误"，把结构化错误回灌给 LLM（配合 P0-1 的错误回灌机制）。

设计原则：
- extra="allow"：LLM 偶尔会带额外字段（如调试信息、变体参数），不为此拒绝合法调用。
- 复杂嵌套结构（如 apply_actions 的 *Spec）不在这一层校验，留给业务层的 ActionValidator，
  避免两处校验逻辑漂移。这里只校验"工具入参骨架"。
- MODEL_FOR_TOOL 是工具名 → 模型类的映射，ToolRegistry.register 时传入。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _ToolArgsBase(BaseModel):
    """所有工具入参模型的基类：允许额外字段，避免误拒 LLM 的合法变体调用。"""

    model_config = ConfigDict(extra="allow")


class ReadProjectArgs(_ToolArgsBase):
    """read_project 无参数（空模型仍可拦截"传了非 dict 入参"的极端情况）。"""


class ReadTableArgs(_ToolArgsBase):
    """read_table 入参：table_name 必填，sample_rows 可选。"""

    table_name: str = Field(..., description="要查看的表名（schema 的 name 或 id）")
    sample_rows: int | None = Field(default=None, description="采样行数")


class ReadCanvasArgs(_ToolArgsBase):
    """read_canvas 无参数。"""


class ValidateTableArgs(_ToolArgsBase):
    """validate_table 入参：table_name 可选（不传则校验所有表）。"""

    table_name: str | None = Field(default=None, description="要校验的表名；不传则校验所有表")


class ApplyActionsArgs(_ToolArgsBase):
    """apply_actions 入参：actions 必填（非空数组）。

    actions 的元素是 dict（每个含 actionType + 对应 *Spec），元素内部结构由 ActionValidator
    校验，这里只保证 actions 是非空 list[dict]，避免重复校验。
    intent_scope 字段为 P2-1 意图校验改造预留（本轮可选）。
    """

    actions: list[dict[str, Any]] = Field(..., description="要执行的动作列表（非空）")
    intent_scope: dict[str, Any] | None = Field(default=None, description="意图范围声明（预留）")

    @field_validator("actions")
    @classmethod
    def _actions_non_empty(cls, v: list[dict[str, Any]]) -> list[dict[str, Any]]:
        # OpenAI schema 的 required 只保证字段存在，空数组会漏过；这里补非空校验
        if not v:
            raise ValueError("actions 不能为空数组")
        return v


class AskUserArgs(_ToolArgsBase):
    """ask_user 入参：question_type 和 prompt 必填，其余按类型可选。"""

    question_type: Literal["free_text", "choice", "value", "confirm"] = Field(..., description="提问类型")
    prompt: str = Field(..., description="给用户看的问题文本")
    options: list[dict[str, Any]] | None = Field(default=None, description="choice 类型必填：候选项列表")
    multiple: bool | None = Field(default=None, description="choice 类型：是否多选")
    value_type: Literal["string", "integer", "float", "boolean"] | None = Field(
        default=None, description="value 类型必填：期望的值类型"
    )
    placeholder: str | None = Field(default=None, description="输入框占位提示")
    optional: bool | None = Field(default=None, description="value 类型：是否允许留空")


# 工具名 → 入参模型 的注册表。ToolRegistry.register 时按名查表。
# 未在此注册的工具（如未来新工具）保持原透传行为，向后兼容。
MODEL_FOR_TOOL: dict[str, type[_ToolArgsBase]] = {
    "read_project": ReadProjectArgs,
    "read_table": ReadTableArgs,
    "read_canvas": ReadCanvasArgs,
    "validate_table": ValidateTableArgs,
    "apply_actions": ApplyActionsArgs,
    "ask_user": AskUserArgs,
}
