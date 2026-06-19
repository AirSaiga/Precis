"""@fileoverview 结果合并工具

Agent 可调用的工具：合并多个分块生成的配置，去重并标记冲突。
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class MergeResultsTool:
    """
    @classdesc 结果合并工具

    合并多个局部配置为一个完整配置。
    """

    NAME = "merge_results"

    def get_definition(self) -> dict[str, Any]:
        """返回 OpenAI tool 定义。"""
        return {
            "type": "function",
            "function": {
                "name": self.NAME,
                "description": "合并多个分块生成的配置，去重并检测冲突。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "configs": {
                            "type": "array",
                            "items": {"type": "object"},
                            "description": "待合并的局部配置列表",
                        },
                    },
                    "required": ["configs"],
                },
            },
        }

    def run(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """
        @methoddesc 执行合并

        参数:
            arguments: tool 参数

        返回:
            {"success": bool, "config": {...}, "warnings": [...], "conflicts": [...]}
        """
        configs = arguments.get("configs", [])
        if not configs:
            return {"success": True, "config": {}, "warnings": [], "conflicts": []}

        merged: dict[str, Any] = {"schemas": {}, "constraints": {}, "regex_nodes": {}}
        warnings: list[str] = []
        conflicts: list[dict[str, Any]] = []

        # 合并 schemas
        for cfg in configs:
            for sid, schema in cfg.get("schemas", {}).items():
                if sid in merged["schemas"]:
                    # 合并列，按 name 去重
                    existing_cols = {c.get("name"): c for c in merged["schemas"][sid].get("columns", [])}
                    for col in schema.get("columns", []):
                        existing_cols[col.get("name")] = col
                    merged["schemas"][sid]["columns"] = list(existing_cols.values())
                else:
                    merged["schemas"][sid] = schema

        # 合并 constraints，按 (table_id, column_id, type) 去重
        seen_constraints: set[tuple[str, str, str]] = set()
        for cfg in configs:
            for cid, cdef in cfg.get("constraints", {}).items():
                ctype = cdef.get("type", "")
                refs = cdef.get("refs", {})
                table_id = refs.get("table_id", "")
                column_id = refs.get("column_id", "")
                column_ids = tuple(refs.get("column_ids", []))
                constraint_key: tuple[str, str, str] = (table_id, column_id or "_".join(column_ids), ctype)
                if constraint_key in seen_constraints:
                    conflicts.append(
                        {
                            "rule_id": cid,
                            "type": ctype,
                            "reason": "重复约束",
                            "key": constraint_key,
                        }
                    )
                    continue
                seen_constraints.add(constraint_key)
                merged["constraints"][cid] = cdef

        # 合并 regex_nodes，按 pattern + source_ref 去重
        seen_regex: set[str] = set()
        for cfg in configs:
            for rid, rdef in cfg.get("regex_nodes", {}).items():
                source_ref = rdef.get("source_ref", {})
                regex_key = (
                    f"{rdef.get('pattern', '')}|{source_ref.get('table_id', '')}|{source_ref.get('column_id', '')}"
                )
                if regex_key in seen_regex:
                    conflicts.append(
                        {
                            "rule_id": rid,
                            "type": "Regex",
                            "reason": "重复正则",
                            "key": regex_key,
                        }
                    )
                    continue
                seen_regex.add(regex_key)
                merged["regex_nodes"][rid] = rdef

        if conflicts:
            warnings.append(f"合并时发现 {len(conflicts)} 处重复，已自动去重")

        return {"success": True, "config": merged, "warnings": warnings, "conflicts": conflicts}
