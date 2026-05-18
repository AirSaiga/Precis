"""
@fileoverview 唯一性约束模块

功能概述:
- 实现 UniqueConstraint 类
- 验证列或列组合的值是否唯一
- 支持单列唯一和联合唯一 (多列组合唯一)

架构设计:
- 继承基类: 继承自 Constraint 抽象类
- 联合唯一: 支持多列组合的唯一性检查
- 重复检测: 使用 pandas duplicated() 方法

输入示例:
    # 约束配置 - 单列唯一
    constraint1 = UniqueConstraint(table="users", column="email")

    # 约束配置 - 联合唯一
    constraint2 = UniqueConstraint(
        table="orders",
        columns=["user_id", "product_id"]  # 同一用户对同一产品只能下一单
    )

    # 数据集输入
    datasets = {
        "users": DataFrame({
            "id": [1, 2, 3],
            "email": ["alice@test.com", "bob@test.com", "alice@test.com"]  # 重复 email
        }),
        "orders": DataFrame({
            "id": [1, 2, 3],
            "user_id": [1, 1, 1],
            "product_id": [100, 100, 100]  # 重复 (user_id, product_id) 组合
        })
    }

输出示例:
    # 单列唯一性验证失败 (第3行 email 重复)
    {
        "errors": [
            {
                "error_type": "UniqueViolation",
                "table": "users",
                "row_index": 2,
                "columns": ["email"],
                "value": "alice@test.com",
                "message": "唯一性冲突: 值 'alice@test.com' 在列 'email' 中不唯一。"
            }
        ],
        "info": {...}
    }

    # 联合唯一性验证失败 (第2、3行重复)
    {
        "errors": [
            {
                "error_type": "UniqueViolation",
                "table": "orders",
                "row_index": 1,
                "columns": ["user_id", "product_id"],
                "value": {"user_id": 1, "product_id": 100},
                "message": "唯一性冲突: 值 '{'user_id': 1, 'product_id': 100}' 在列 'user_id, product_id' 中不唯一。"
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


class UniqueConstraint(Constraint):
    """
    @classdesc 唯一性约束

    验证指定列或列组合中的值是否唯一。
    支持单列唯一（如 email 不重复）和联合唯一（如 user_id + product_id 组合不重复）。
    """

    def __init__(self, table: str, column: str | list[str]):
        """
        @methoddesc 初始化唯一性约束

        参数:
            table: 目标表名
            column: 目标列名，可以是字符串（单列）或字符串列表（联合唯一）

        抛出:
            ValueError: 当 table 为空、column 为空或列表中包含空值时抛出
        """
        if not table or not table.strip():
            raise ValueError("table 不能为空")

        # 统一将 column 转为列表，方便后续处理
        if isinstance(column, str):
            if not column.strip():
                raise ValueError("column 不能为空")
            columns = [column]
        else:
            if not column:
                raise ValueError("column 列表不能为空")
            if not all(c and c.strip() for c in column):
                raise ValueError("column 列表中包含空值")
            columns = list(column)

        self.table = table
        self.columns = columns

    def _get_description(self) -> str:
        """生成唯一性约束描述"""
        columns_str = ", ".join(self.columns) if isinstance(self.columns, list) else self.columns
        return f"唯一性约束: {self.table}.{columns_str}"

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        """
        @methoddesc 执行唯一性验证

        参数:
            datasets: 数据集字典，键为表名，值为 pandas DataFrame
            **kwargs: 额外的关键字参数（本方法不使用）

        返回:
            验证结果字典，包含 errors（错误列表）和 info（约束信息）

        逻辑说明:
            1. 检查目标表是否存在于数据集中
            2. 检查 columns 列表是否为空
            3. 检查每个列是否都存在于目标表中
            4. 使用 pandas duplicated() 找出重复的行（keep=False 表示所有重复行都标记）
            5. 为每个重复行生成错误记录
        """
        errors = []

        # 检查目标表是否存在
        if self.table not in datasets:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.columns[0] if self.columns else None,
                    "message": f"唯一约束失败: 表 '{self.table}' 不在提供的数据集中。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        df = datasets[self.table]

        # 检查是否指定了列
        if not self.columns:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": None,
                    "message": "唯一约束配置错误: 未指定任何列。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        # 检查每个列是否存在于表中
        for col in self.columns:
            if col not in df.columns:
                errors.append(
                    {
                        "error_type": "ConstraintConfigError",
                        "table": self.table,
                        "column": col,
                        "message": f"唯一约束失败: 列 '{col}' 在表 '{self.table}' 中不存在。",
                    }
                )
                return {"errors": errors, "info": self.get_constraint_info()}

        # 使用 duplicated() 找出重复的行
        # keep=False 表示将所有重复的行都标记为重复（包括第一次出现的）
        duplicates = df[df.duplicated(subset=self.columns, keep=False)]

        # 遍历所有重复行，生成错误记录
        for row_tuple in duplicates[self.columns].itertuples(index=True, name=None):
            index = row_tuple[0]
            # 如果是多列联合唯一，value 用字典表示；如果是单列，直接用值
            if len(self.columns) > 1:
                value = dict(zip(self.columns, row_tuple[1:]))
            else:
                value = row_tuple[1]
            row_index = int(index) if index is not None else 0
            errors.append(
                {
                    "error_type": "UniqueViolation",
                    "table": self.table,
                    "row_index": row_index,
                    "columns": self.columns,
                    "value": value,
                    "message": f"唯一性冲突: 值 '{value}' 在列 '{', '.join(self.columns)}' 中不唯一。",
                }
            )

        return {"errors": errors, "info": self.get_constraint_info()}
