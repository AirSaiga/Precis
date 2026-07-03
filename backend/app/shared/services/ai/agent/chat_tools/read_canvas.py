"""@fileoverview read_canvas 工具

Chat mini-agent 可调用的工具：读取当前画布上实际显示的节点快照。

与 read_project 的关键区别：
- read_project 读项目配置文件（YAML），返回"项目里配置了什么"。
- read_canvas 读请求时前端带来的画布快照，返回"画布上现在显示什么"。
按项目架构，Schema/Constraint/Regex 节点不自动加载到画布，
故两者会分叉——判断"画布上有没有 X"必须用本工具。

无 project_path 依赖：画布数据在 runner 构造时已注入（来自请求体 canvasNodes 字段）。
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# 画布上需要计数的业务节点类型前缀/集合，用于生成 summary
_CONSTRAINT_TYPE_SUFFIX = "Constraint"
_SCHEMA_TYPES = frozenset({"schema", "jsonSchema"})
_SOURCE_TYPES = frozenset({"sourcePreview", "jsonSourcePreview"})


def _summarize_canvas(nodes: list[dict[str, Any]]) -> dict[str, int]:
    """统计画布快照中各类业务节点的数量，便于 LLM 快速判断。"""
    schema_count = 0
    constraint_count = 0
    regex_count = 0
    transform_count = 0
    other_count = 0

    for n in nodes:
        ntype = n.get("type", "")
        if ntype in _SCHEMA_TYPES:
            schema_count += 1
        elif ntype.endswith(_CONSTRAINT_TYPE_SUFFIX):
            constraint_count += 1
        elif ntype == "regex":
            regex_count += 1
        elif ntype in ("transform", "transformOutput"):
            transform_count += 1
        else:
            other_count += 1

    return {
        "total": len(nodes),
        "schema_count": schema_count,
        "constraint_count": constraint_count,
        "regex_count": regex_count,
        "transform_count": transform_count,
        "other_count": other_count,
    }


class ReadCanvasTool:
    """
    @classdesc 读取画布节点快照工具

    返回当前画布上实际显示的节点（由前端在请求体携带），
    区别于 read_project 返回的项目配置文件内容。
    """

    NAME = "read_canvas"

    def __init__(self, canvas_nodes: list[dict[str, Any]] | None = None):
        """
        @methoddesc 初始化工具

        参数:
            canvas_nodes: 前端在请求体携带的画布节点快照（已裁剪）。
                runner 构造时注入；None/空视为空画布。
        """
        # 防御性拷贝：避免外部 mutate 影响工具内视图
        self._canvas_nodes: list[dict[str, Any]] = list(canvas_nodes) if canvas_nodes else []

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": (
                    "读取当前**画布上实际显示**的节点列表（Schema、约束、正则、转换等），"
                    "含每类节点数量摘要。"
                    "本工具返回的是画布快照，与 read_project 读项目配置文件不同——"
                    "项目配置里有的表/约束不一定已拖到画布上。"
                    "当用户说'画布上有没有 X'、'把 Y 放到画布/拖到画布'、"
                    "'画布上现在有什么'时，先调用本工具确认画布真实状态，再决定是否需要 ADD 动作。"
                    "无需参数。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            },
        }

    async def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 返回画布节点快照与摘要

        参数:
            arguments: tool 参数（本工具无参数，保留接口一致性）

        返回:
            {"success": bool, "canvas_nodes": [...], "summary": {...}, "error": str}
            canvas_nodes 为前端裁剪后的节点摘要列表；空画布返回空列表而非错误。
        """
        # 本工具无参数，arguments 仅保留接口一致性
        _ = arguments

        try:
            summary = _summarize_canvas(self._canvas_nodes)
            return {
                "success": True,
                "canvas_nodes": self._canvas_nodes,
                "summary": summary,
            }
        except Exception as e:
            logger.exception("read_canvas 工具执行失败")
            return {"success": False, "error": f"读取画布快照失败: {e}", "canvas_nodes": [], "summary": {}}
