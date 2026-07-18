"""
MaxLength 约束参考实现（C01 SOLUTION）。

限制字符串列的最大字符长度。
None/NaN 值跳过（空值归 NotNull 管）。
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.shared.domain.constraints.base import Constraint


class MaxLengthConstraint(Constraint):
    """最大长度约束：列中字符串值的字符长度不得超过 max_length。"""

    def __init__(self, table: str, column: str, max_length: int):
        self.table = table
        self.column = column
        self.max_length = max_length

    def _get_description(self) -> str:
        return f"最大长度约束: {self.table}.{self.column} ≤ {self.max_length}"

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        errors: list[dict[str, Any]] = []

        # 表不存在
        if self.table not in datasets:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.column,
                    "message": f"最大长度约束失败: 表 '{self.table}' 不在数据集中。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        df = datasets[self.table]

        # 列不存在
        if self.column not in df.columns:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.column,
                    "message": f"最大长度约束失败: 列 '{self.column}' 在表 '{self.table}' 中不存在。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        col = df[self.column]

        # 跳过 None/NaN，只检查非空值的长度
        for index, value in col.items():
            # pd.isnull 对标量返回 bool，对 NaN/None 都为 True
            if pd.isna(value):
                continue
            if len(str(value)) > self.max_length:
                errors.append(
                    {
                        "error_type": "MaxLengthViolation",
                        "table": self.table,
                        "row_index": int(index) if index is not None else 0,
                        "column": self.column,
                        "value": value,
                        "max_length": self.max_length,
                        "message": (
                            f"最大长度约束冲突: 列 '{self.column}' 的值长度 "
                            f"{len(str(value))} 超过最大长度 {self.max_length}。"
                        ),
                    }
                )

        return {"errors": errors, "info": self.get_constraint_info()}
