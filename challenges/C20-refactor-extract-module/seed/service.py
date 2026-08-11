"""统一校验服务（C20 seed —— 过大，需提取格式化辅助函数）。

本文件含：
- UnifiedValidationService 类（主服务，2 个公有方法）
- 4 个 _format_xxx 私有辅助函数（格式化错误 dict，应提取到 formatters.py）

任务：把 4 个 _format_xxx 函数提取到新模块 workspace/formatters.py，
service.py 通过 import 引用它们，行为不变。
"""

from __future__ import annotations

from typing import Any


# ============================================================================
# 格式化辅助函数 —— 这 4 个是内聚的一组，应提取到 formatters.py
# ============================================================================


def _format_not_null_error(column: str, row: int) -> dict[str, Any]:
    """格式化非空错误。"""
    return {
        "error_type": "NotNullViolation",
        "column": column,
        "row_index": row,
        "message": f"列 '{column}' 的值不能为空",
    }


def _format_unique_error(column: str, row: int, value: Any) -> dict[str, Any]:
    """格式化唯一性错误。"""
    return {
        "error_type": "UniqueViolation",
        "column": column,
        "row_index": row,
        "value": value,
        "message": f"列 '{column}' 的值 '{value}' 重复",
    }


def _format_range_error(
    column: str, row: int, value: Any, min_val: float, max_val: float
) -> dict[str, Any]:
    """格式化范围错误。"""
    return {
        "error_type": "RangeViolation",
        "column": column,
        "row_index": row,
        "value": value,
        "message": f"列 '{column}' 的值 {value} 不在 [{min_val}, {max_val}] 内",
    }


def _format_foreign_key_error(
    column: str, row: int, value: Any, ref_table: str
) -> dict[str, Any]:
    """格式化外键错误。"""
    return {
        "error_type": "ForeignKeyViolation",
        "column": column,
        "row_index": row,
        "value": value,
        "message": f"列 '{column}' 的值 '{value}' 在引用表 '{ref_table}' 中不存在",
    }


# ============================================================================
# 主服务类（不提取）
# ============================================================================


class UnifiedValidationService:
    """统一校验服务。"""

    def validate_not_null(self, column: str, rows: list[int]) -> list[dict[str, Any]]:
        return [_format_not_null_error(column, r) for r in rows]

    def validate_unique(
        self, column: str, duplicates: list[tuple[int, Any]]
    ) -> list[dict[str, Any]]:
        return [_format_unique_error(column, r, v) for r, v in duplicates]
