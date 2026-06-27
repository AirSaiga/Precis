"""@fileoverview MergeResultsTool 单元测试

覆盖多分片配置合并、去重与冲突检测。
"""

from __future__ import annotations

import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from app.shared.services.ai.agent.tools.merge_results import MergeResultsTool


def _make_schema(columns: list[dict]) -> dict:
    """构造 schema 字典。"""
    return {"columns": columns}


def _make_constraint(cid: str, ctype: str, table_id: str, column_id: str = "") -> dict:
    """构造 constraint 字典。"""
    refs: dict = {"table_id": table_id}
    if column_id:
        refs["column_id"] = column_id
    return {"type": ctype, "refs": refs}


def _make_regex(rid: str, pattern: str, table_id: str = "", column_id: str = "") -> dict:
    """构造 regex_node 字典。"""
    return {
        "pattern": pattern,
        "source_ref": {"table_id": table_id, "column_id": column_id},
    }


class TestMergeResultsTool:
    """MergeResultsTool 测试套件。"""

    def test_empty_configs_returns_empty(self):
        """空配置列表返回空结果。"""
        tool = MergeResultsTool()
        result = tool.run({"configs": []})

        assert result["success"] is True
        assert result["config"] == {}
        assert result["warnings"] == []
        assert result["conflicts"] == []

    def test_merge_schemas_same_table_different_columns(self):
        """两分片同表不同列合并后列齐全并去重。"""
        tool = MergeResultsTool()
        configs = [
            {
                "schemas": {
                    "users": _make_schema([{"name": "id"}, {"name": "name"}]),
                },
            },
            {
                "schemas": {
                    "users": _make_schema([{"name": "name"}, {"name": "email"}]),
                },
            },
        ]
        result = tool.run({"configs": configs})

        assert result["success"] is True
        users = result["config"]["schemas"]["users"]
        column_names = [c["name"] for c in users["columns"]]
        assert column_names == ["id", "name", "email"]

    def test_merge_constraints_same_key_becomes_conflict(self):
        """相同 (table_id, column_id, type) 的约束产生冲突。"""
        tool = MergeResultsTool()
        configs = [
            {
                "constraints": {
                    "c1": _make_constraint("c1", "NotNull", "users", "id"),
                },
            },
            {
                "constraints": {
                    "c2": _make_constraint("c2", "NotNull", "users", "id"),
                },
            },
        ]
        result = tool.run({"configs": configs})

        assert result["success"] is True
        assert len(result["config"]["constraints"]) == 1
        assert len(result["conflicts"]) == 1
        conflict = result["conflicts"][0]
        assert conflict["type"] == "NotNull"
        assert conflict["reason"] == "重复约束"
        assert "去重" in result["warnings"][0]

    def test_merge_regex_same_pattern_deduped(self):
        """相同 pattern + source_ref 的正则去重。"""
        tool = MergeResultsTool()
        configs = [
            {
                "regex_nodes": {
                    "r1": _make_regex("r1", r"^\d+$", "users", "phone"),
                },
            },
            {
                "regex_nodes": {
                    "r2": _make_regex("r2", r"^\d+$", "users", "phone"),
                },
            },
        ]
        result = tool.run({"configs": configs})

        assert result["success"] is True
        assert len(result["config"]["regex_nodes"]) == 1
        assert len(result["conflicts"]) == 1
        assert result["conflicts"][0]["type"] == "Regex"

    def test_merge_multiple_tables(self):
        """多表配置合并保留各自 schema。"""
        tool = MergeResultsTool()
        configs = [
            {"schemas": {"users": _make_schema([{"name": "id"}])}},
            {"schemas": {"orders": _make_schema([{"name": "order_id"}])}},
        ]
        result = tool.run({"configs": configs})

        schemas = result["config"]["schemas"]
        assert set(schemas.keys()) == {"users", "orders"}
