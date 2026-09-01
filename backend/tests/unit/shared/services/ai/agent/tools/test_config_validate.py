"""@fileoverview ConfigValidateTool 单元测试

覆盖 AllowedValues 校验中布尔掩码与 dropna 子集的对齐：
列含 NaN 时 invalid 掩码来自 col.dropna()，直接用它索引全量列会
因索引不对齐抛 IndexError（缺陷修复点）。
"""

from __future__ import annotations

import pandas as pd

from app.shared.services.ai.agent.tools.config_validate import ConfigValidateTool


def _write_csv(tmp_path, df: pd.DataFrame) -> str:
    csv_path = tmp_path / "users.csv"
    df.to_csv(csv_path, index=False)
    return str(csv_path)


def _allowed_values_config(csv_path: str) -> dict:
    return {
        "schemas": {"users": {"id": "users", "source": {"path": csv_path}}},
        "constraints": {
            "status_allowed": {
                "id": "status_allowed",
                "type": "AllowedValues",
                "refs": {"table_id": "users", "column_id": "status"},
                "params": {"allowed_values": ["A"]},
            }
        },
    }


class TestAllowedValuesMaskAlignment:
    def test_invalid_values_mask_aligned_with_dropna(self, tmp_path):
        """列含 NaN 且存在非法值时：不崩溃、能判定失败、非法值收集正确。

        数据 5 行（含 1 个 NaN）：dropna 后 4 行，其中 2 行非法 → 50% > 5% → failed。
        修复前 col[invalid] 用 4 行掩码索引 5 行全量列，抛 IndexError。
        """
        df = pd.DataFrame({"status": ["A", None, "BAD1", "BAD2", "A"]})
        csv_path = _write_csv(tmp_path, df)

        tool = ConfigValidateTool(file_paths=[csv_path], profiling_data=[])
        result = tool.run({"config": _allowed_values_config(csv_path)})

        assert result["success"] is True
        assert result["total_rules"] == 1
        assert result["failed"] == 1
        issue = result["issues"][0]
        assert issue["type"] == "AllowedValues"
        assert issue["column"] == "status"
        # 非法值收集自 dropna 子集，NaN 不参与
        assert set(issue["invalid_values"].keys()) == {"BAD1", "BAD2"}

    def test_all_values_allowed_passes(self, tmp_path):
        df = pd.DataFrame({"status": ["A", "A", None, "A"]})
        csv_path = _write_csv(tmp_path, df)

        tool = ConfigValidateTool(file_paths=[csv_path], profiling_data=[])
        result = tool.run({"config": _allowed_values_config(csv_path)})

        assert result["success"] is True
        assert result["passed"] == 1
        assert result["issues"] == []

    def test_no_nan_still_collects_invalid_values(self, tmp_path):
        """无 NaN 的常规路径回归：非法值收集不受修复影响。"""
        df = pd.DataFrame({"status": ["A", "BAD1", "BAD2", "BAD3"]})
        csv_path = _write_csv(tmp_path, df)

        tool = ConfigValidateTool(file_paths=[csv_path], profiling_data=[])
        result = tool.run({"config": _allowed_values_config(csv_path)})

        assert result["failed"] == 1
        issue = result["issues"][0]
        assert set(issue["invalid_values"].keys()) == {"BAD1", "BAD2", "BAD3"}
