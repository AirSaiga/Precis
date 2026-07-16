"""
@fileoverview 允许值约束模块

功能概述:
- 实现 AllowedValuesConstraint 类
- 验证列的值是否在允许的集合内

架构设计:
- 继承基类: 继承自 Constraint 抽象类
- 集合验证: 使用 pandas isin() 方法检测非法值
- 空值处理: 自动排除空值，不视为违规

输入示例:
    # 约束配置
    constraint = AllowedValuesConstraint(
        table="users",
        column="status",
        allowed_values={"active", "inactive", "pending"}
    )

    # 数据集输入
    datasets = {
        "users": DataFrame({
            "id": [1, 2, 3, 4],
            "status": ["active", "active", "pending", "deleted"]  # "deleted" 不在允许值中
        })
    }

输出示例:
    # 验证通过
    {"errors": [], "info": {...}}

    # 验证失败 (第4行 status 为 "deleted")
    {
        "errors": [
            {
                "error_type": "AllowedValuesViolation",
                "table": "users",
                "row_index": 3,
                "column": "status",
                "value": "deleted",
                "message": "允许值约束冲突: 值 'deleted' 不在允许的集合 {'active', 'inactive', 'pending'} 中。"
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


class AllowedValuesConstraint(Constraint):
    """
    @classdesc 允许值约束

    验证指定列中的每个值是否都存在于预定义的允许值集合中。
    常用于枚举类型字段的校验，如状态码、性别、类型等。
    """

    def __init__(self, table: str, column: str, allowed_values: set[Any]):
        """
        @methoddesc 初始化允许值约束

        参数:
            table: 目标表名
            column: 目标列名
            allowed_values: 允许值的集合，列中的值必须属于此集合

        抛出:
            ValueError: 当 allowed_values 为空集合、table 为空或 column 为空时抛出
        """
        if not allowed_values:
            raise ValueError("allowed_values 不能为空集合")

        if not table or not table.strip():
            raise ValueError("table 不能为空")

        if not column or not column.strip():
            raise ValueError("column 不能为空")

        self.table = table
        self.column = column
        self.allowed_values = allowed_values

    def _get_description(self) -> str:
        """生成约束描述，如果允许值过多则只显示前5个"""
        values_str = (
            str(self.allowed_values) if len(self.allowed_values) <= 5 else f"{list(self.allowed_values)[:5]}..."
        )
        return f"允许值约束: {self.table}.{self.column} 允许值 {values_str}"

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        """
        @methoddesc 执行允许值验证

        参数:
            datasets: 数据集字典，键为表名，值为 pandas DataFrame
            **kwargs: 额外的关键字参数（本方法不使用）

        返回:
            验证结果字典，包含 errors（错误列表）和 info（约束信息）

        逻辑说明:
            1. 检查目标表是否存在于数据集中
            2. 检查目标列是否存在于目标表中
            3. 使用 pandas 的 isin() 找出不在允许值集合中的行
            4. 排除空值（空值不视为违规）
            5. 为每个违规行生成错误记录
        """
        errors: list[dict[str, Any]] = []

        # 步骤1: 检查目标表是否存在
        if self.table not in datasets:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.column,
                    "message": f"允许值约束失败: 表 '{self.table}' 不在数据集中。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        df = datasets[self.table]

        # 步骤2: 检查目标列是否存在
        if self.column not in df.columns:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.column,
                    "message": f"允许值约束失败: 列 '{self.column}' 在表 '{self.table}' 中不存在。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        # 步骤3: 找出不在允许值集合中的行，同时排除空值
        # 回归 D5: YAML 常以字符串配置枚举(前端下拉),但数值列解析后是 int,1 != "1" 导致
        # isin 全 False → 全行误报。这里把列值与允许值都归一为字符串后再比较,使 "1" 与 1 等价。
        col_series = df[self.column]
        non_null_mask = col_series.notna()
        # 仅对非空值做字符串化比较(NaN 已被 non_null_mask 排除,不参与 isin 判定)
        str_col = col_series.astype(str)
        str_allowed = {str(v) for v in self.allowed_values}
        invalid_mask = non_null_mask & ~str_col.isin(str_allowed)
        invalid_rows = df[invalid_mask]

        # 步骤4: 遍历所有违规行，生成错误记录
        for row_tuple in invalid_rows[[self.column]].itertuples(index=True, name=None):
            index = row_tuple[0]
            value = row_tuple[1]
            row_index = int(index) if index is not None else 0
            errors.append(
                {
                    "error_type": "AllowedValuesViolation",
                    "table": self.table,
                    "row_index": row_index,
                    "column": self.column,
                    "value": value,
                    "message": f"允许值约束冲突: 值 '{value}' 不在允许的集合 {self.allowed_values} 中。",
                }
            )

        return {"errors": errors, "info": self.get_constraint_info()}
