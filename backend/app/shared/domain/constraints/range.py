"""
@fileoverview 范围约束模块

功能概述:
- 实现 RangeConstraint 类
- 验证数值列是否在指定范围内
- 支持开区间和闭区间
- 支持 pandas 数值类型和 Python Decimal 类型

架构设计:
- 继承基类: 继承自 Constraint 抽象类
- 边界模式: inclusive (闭区间) / exclusive (开区间)
- 类型检查: 验证列是否为数值类型（包括 float、int、Decimal）

输入示例:
    # 约束配置 - 闭区间 [0, 100]
    constraint1 = RangeConstraint(
        table="products",
        column="price",
        min_value=0,
        max_value=100,
        boundary_mode="inclusive"
    )

    # 约束配置 - 开区间 (0, 100)
    constraint2 = RangeConstraint(
        table="users",
        column="age",
        min_value=0,
        max_value=150,
        boundary_mode="exclusive"
    )

    # 约束配置 - 仅最小值
    constraint3 = RangeConstraint(
        table="orders",
        column="quantity",
        min_value=1
    )

    # 数据集输入
    datasets = {
        "products": DataFrame({
            "id": [1, 2, 3],
            "price": [50, -10, 150]  # -10 和 150 超出范围
        })
    }

输出示例:
    # 验证失败 (第2行 price=-10, 第3行 price=150)
    {
        "errors": [
            {
                "error_type": "RangeViolation",
                "table": "products",
                "row_index": 1,
                "column": "price",
                "value": -10,
                "message": "区间约束冲突: 值 -10 不在范围 [0, 100] 内。"
            },
            {
                "error_type": "RangeViolation",
                "table": "products",
                "row_index": 2,
                "column": "price",
                "value": 150,
                "message": "区间约束冲突: 值 150 不在范围 [0, 100] 内。"
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


class RangeConstraint(Constraint):
    """
    @classdesc 区间约束

    验证数值列的值是否在指定的范围内。
    支持闭区间（包含边界）和开区间（不包含边界）两种模式。
    """

    def __init__(
        self,
        table: str,
        column: str,
        min_value: float | None = None,
        max_value: float | None = None,
        boundary_mode: str = "inclusive",
    ):
        """
        @methoddesc 初始化区间约束

        参数:
            table: 目标表名
            column: 目标列名
            min_value: 最小值，None 表示不限制下限
            max_value: 最大值，None 表示不限制上限
            boundary_mode: 边界模式，"inclusive"（闭区间，包含边界）或 "exclusive"（开区间，不包含边界）

        抛出:
            ValueError: 当 boundary_mode 不是 "inclusive" 或 "exclusive" 时抛出
            ValueError: 当 min_value 大于 max_value 时抛出
        """
        if boundary_mode not in ("inclusive", "exclusive"):
            raise ValueError(f"boundary_mode 必须是 'inclusive' 或 'exclusive'，当前值: '{boundary_mode}'")

        if min_value is not None and max_value is not None and min_value > max_value:
            raise ValueError(f"min_value ({min_value}) 不能大于 max_value ({max_value})")

        self.table = table
        self.column = column
        self.min_value = min_value
        self.max_value = max_value
        self.boundary_mode = boundary_mode

    def _get_description(self) -> str:
        """根据边界模式生成区间描述"""
        if self.min_value is not None and self.max_value is not None:
            boundary_desc = (
                f"[{self.min_value}, {self.max_value}]"
                if self.boundary_mode == "inclusive"
                else f"({self.min_value}, {self.max_value})"
            )
            return f"区间约束: {self.table}.{self.column} 范围 {boundary_desc}"
        if self.min_value is not None:
            op = ">=" if self.boundary_mode == "inclusive" else ">"
            return f"区间约束: {self.table}.{self.column} {op} {self.min_value}"
        if self.max_value is not None:
            op = "<=" if self.boundary_mode == "inclusive" else "<"
            return f"区间约束: {self.table}.{self.column} {op} {self.max_value}"
        return f"区间约束: {self.table}.{self.column}"

    def _is_numeric_column(self, series: pd.Series) -> bool:
        """检查列是否为数值类型（支持 pandas 数值类型和 Python Decimal）。

        参数:
            series: pandas Series

        返回:
            是否为数值类型
        """
        # 1. 检查是否为 pandas 数值类型
        if pd.api.types.is_numeric_dtype(series):
            return True

        # 2. 检查是否为 Decimal 类型（object dtype 但包含 Decimal 值）
        if series.dtype == object:
            non_null_values = series.dropna()
            if len(non_null_values) > 0:
                from decimal import Decimal

                first_value = non_null_values.iloc[0]
                if isinstance(first_value, Decimal):
                    return True

        return False

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        """
        @methoddesc 执行区间验证

        参数:
            datasets: 数据集字典，键为表名，值为 pandas DataFrame
            **kwargs: 额外的关键字参数（本方法不使用）

        返回:
            验证结果字典，包含 errors（错误列表）和 info（约束信息）

        逻辑说明:
            1. 检查目标表是否存在
            2. 检查目标列是否存在
            3. 检查列是否为数值类型
            4. 根据边界模式构建布尔掩码，筛选出不在范围内的行
            5. 排除空值（空值不视为违规）
            6. 为每个违规行生成错误记录
        """
        errors: list[dict[str, Any]] = []

        # 检查目标表是否存在
        if self.table not in datasets:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.column,
                    "message": f"区间约束失败: 表 '{self.table}' 不在数据集中。",
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
                    "message": f"区间约束失败: 列 '{self.column}' 在表 '{self.table}' 中不存在。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        # 检查列是否为数值类型（支持 pandas 数值类型和 Python Decimal）
        if not self._is_numeric_column(df[self.column]):
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.column,
                    "message": f"区间约束失败: 列 '{self.column}' 不是数值类型。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        # 回归 D9: Decimal 列的大额值转 float64 会丢精度(float64 仅 ~15-17 位有效数字),
        # 导致边界误判。检测到 Decimal 列时,把列值与边界都转 Decimal 后逐行比较,保持精度。
        from decimal import Decimal, InvalidOperation

        col_series = df[self.column]
        is_decimal_col = False
        if col_series.dtype == object:
            non_null = col_series.dropna()
            if len(non_null) > 0 and isinstance(non_null.iloc[0], Decimal):
                is_decimal_col = True

        if is_decimal_col:
            # Decimal 空间比较,避免 float64 丢精度
            min_dec = Decimal(str(self.min_value)) if self.min_value is not None else None
            max_dec = Decimal(str(self.max_value)) if self.max_value is not None else None

            def _in_range(v: Any) -> bool:
                if v is None or (isinstance(v, float) and pd.isna(v)):
                    return True  # 空值不视为违规(下方 dropna 也会处理)
                try:
                    dv = v if isinstance(v, Decimal) else Decimal(str(v))
                except (InvalidOperation, ValueError):
                    return False
                if min_dec is not None:
                    if self.boundary_mode == "inclusive" and dv < min_dec:
                        return False
                    if self.boundary_mode == "exclusive" and dv <= min_dec:
                        return False
                if max_dec is not None:
                    if self.boundary_mode == "inclusive" and dv > max_dec:
                        return False
                    if self.boundary_mode == "exclusive" and dv >= max_dec:
                        return False
                return True

            mask = col_series.apply(_in_range)
        else:
            numeric_series = pd.to_numeric(col_series, errors="coerce")

            # 初始化掩码: 所有行默认都在范围内（True）
            mask = pd.Series([True] * len(df), index=df.index)

            # 应用最小值约束
            if self.min_value is not None:
                if self.boundary_mode == "inclusive":
                    mask = mask & (numeric_series >= self.min_value)
                else:
                    mask = mask & (numeric_series > self.min_value)

            # 应用最大值约束
            if self.max_value is not None:
                if self.boundary_mode == "inclusive":
                    mask = mask & (numeric_series <= self.max_value)
                else:
                    mask = mask & (numeric_series < self.max_value)

        # 取反得到不在范围内的行，并排除空值
        invalid_rows = df[~mask].dropna(subset=[self.column])

        # 为每个违规行生成错误记录
        for row_tuple in invalid_rows[[self.column]].itertuples(index=True, name=None):
            index = row_tuple[0]
            value = row_tuple[1]
            row_index = int(index) if index is not None else 0

            # 根据配置生成对应的错误消息
            if self.min_value is not None and self.max_value is not None:
                boundary_desc = (
                    f"[{self.min_value}, {self.max_value}]"
                    if self.boundary_mode == "inclusive"
                    else f"({self.min_value}, {self.max_value})"
                )
                message = f"区间约束冲突: 值 {value} 不在范围 {boundary_desc} 内。"
            elif self.min_value is not None:
                op = ">=" if self.boundary_mode == "inclusive" else ">"
                message = f"区间约束冲突: 值 {value} 不满足 {op} {self.min_value}。"
            elif self.max_value is not None:
                op = "<=" if self.boundary_mode == "inclusive" else "<"
                message = f"区间约束冲突: 值 {value} 不满足 {op} {self.max_value}。"
            else:
                message = f"区间约束冲突: 值 {value} 超出指定范围。"

            errors.append(
                {
                    "error_type": "RangeViolation",
                    "table": self.table,
                    "row_index": row_index,
                    "column": self.column,
                    "value": value,
                    "message": message,
                }
            )

        return {"errors": errors, "info": self.get_constraint_info()}
