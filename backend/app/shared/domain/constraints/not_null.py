"""
@fileoverview 非空约束模块

功能概述:
- 实现 NotNullConstraint 类
- 验证指定列的值是否为空

架构设计:
- 继承基类: 继承自 Constraint 抽象类
- 简单验证: 使用 pandas isnull() 检测空值

输入示例:
    # 约束配置
    constraint = NotNullConstraint(table="users", column="username")

    # 数据集输入
    datasets = {
        "users": DataFrame({
            "id": [1, 2, 3],
            "username": ["alice", "bob", None],  # 第3行为空
            "email": ["a@test.com", "b@test.com", "c@test.com"]
        })
    }

输出示例:
    # 验证通过
    {
        "errors": [],
        "info": {
            "constraint_type": "NotNullConstraint",
            "table": "users",
            "description": "非空约束: users.username"
        }
    }

    # 验证失败 (第3行 username 为空)
    {
        "errors": [
            {
                "error_type": "NotNullViolation",
                "table": "users",
                "row_index": 2,
                "column": "username",
                "value": None,
                "message": "非空约束冲突: 列 'username' 的值不能为空。"
            }
        ],
        "info": {...}
    }

    # 配置错误 (列不存在)
    {
        "errors": [
            {
                "error_type": "ConstraintConfigError",
                "table": "users",
                "column": "nonexistent_column",
                "message": "非空约束失败: 列 'nonexistent_column' 在表 'users' 中不存在。"
            }
        ],
        "info": {...}
    }
"""

from __future__ import annotations

# 1. 标准库导入
from typing import Any

# 2. 第三方库导入
import pandas as pd

# 3. 项目内部导入
from app.shared.domain.constraints.base import Constraint


class NotNullConstraint(Constraint):
    """
    @classdesc 非空约束

    验证指定列中的每个值都不为空。
    空值包括: None、NaN、以及仅包含空白字符的字符串。
    """

    def __init__(self, table: str, column: str):
        """
        @methoddesc 初始化非空约束

        参数:
            table: 目标表名
            column: 目标列名
        """
        self.table = table
        self.column = column

    def _get_description(self) -> str:
        """生成非空约束描述"""
        return f"非空约束: {self.table}.{self.column}"

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        """
        @methoddesc 执行非空验证

        参数:
            datasets: 数据集字典，键为表名，值为 pandas DataFrame
            **kwargs: 额外的关键字参数（本方法不使用）

        返回:
            验证结果字典，包含 errors（错误列表）和 info（约束信息）

        逻辑说明:
            1. 检查目标表是否存在于数据集中
            2. 检查目标列是否存在于目标表中
            3. 使用 pandas isnull() 检测空值
            4. 对于字符串类型的列，额外检测仅包含空白字符的值
            5. 为每个空值行生成错误记录
        """
        errors: list[dict[str, Any]] = []

        # 检查目标表是否存在
        if self.table not in datasets:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.column,
                    "message": f"非空约束失败: 表 '{self.table}' 不在数据集中。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        df = datasets[self.table]

        # 检查目标列是否存在
        if self.column not in df.columns:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.column,
                    "message": f"非空约束失败: 列 '{self.column}' 在表 '{self.table}' 中不存在。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        col = df[self.column]

        # 使用 pandas isnull() 检测 None、NaN 等空值
        is_null = col.isnull()

        # 对于 object 类型（通常是字符串），额外检测仅包含空白字符的值
        # 如 "  "、"\t\n" 等也应视为空值
        if col.dtype == object:
            is_null = is_null | (col.astype(str).str.strip() == "")

        # 遍历所有空值行，生成错误记录
        for index in df[is_null].index:
            row_index = int(index) if index is not None else 0
            errors.append(
                {
                    "error_type": "NotNullViolation",
                    "table": self.table,
                    "row_index": row_index,
                    "column": self.column,
                    "value": None,
                    "message": f"非空约束冲突: 列 '{self.column}' 的值不能为空。",
                }
            )

        return {"errors": errors, "info": self.get_constraint_info()}
