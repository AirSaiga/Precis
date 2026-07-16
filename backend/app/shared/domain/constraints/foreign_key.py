"""
@fileoverview 外键约束模块

功能概述:
- 实现 ForeignKeyConstraints 类
- 验证外键列的值是否在目标表的对应列中存在
- 确保引用完整性: 子表的值必须在父表中存在

架构设计:
- 继承基类: 继承自 Constraint 抽象类
- 引用验证: 检查 from_column 的值是否在 to_column 中存在
- 值规范化: 自动处理类型转换和空值

输入示例:
    # 约束配置: orders.user_id 必须存在于 users.id 中
    constraint = ForeignKeyConstraints(
        from_table="orders",
        from_column="user_id",
        to_table="users",
        to_column="id"
    )

    # 数据集输入
    datasets = {
        "users": DataFrame({
            "id": [1, 2, 3],
            "username": ["alice", "bob", "charlie"]
        }),
        "orders": DataFrame({
            "id": [1, 2, 3],
            "user_id": [1, 2, 99]  # 99 不在 users.id 中
        })
    }

输出示例:
    # 验证通过
    {"errors": [], "info": {...}}

    # 验证失败 (第3行 user_id=99 在 users 表中不存在)
    {
        "errors": [
            {
                "error_type": "ForeignKeyViolation",
                "table": "orders",
                "row_index": 2,
                "column": "user_id",
                "value": 99,
                "message": "外键冲突: 值 '99' 在目标表 'users' 的列 'id' 中不存在。"
            }
        ],
        "info": {
            "constraint_type": "ForeignKeyConstraints",
            "table": "orders",
            "description": "外键约束: orders.user_id -> users.id"
        }
    }

原理说明:
    值规范化处理:
    - 字符串前后空格会被去除
    - "123.0" 会被规范化为 "123"
    - 空字符串、None、NaN 会被规范化为 None (不检查)
    - 布尔值会被转换为 "True"/"False"
    - 浮点数会去掉小数点后的 .0
"""

from __future__ import annotations

# 1. 标准库导入
import re
from typing import Any

# 2. 第三方库导入
import pandas as pd

# 3. 项目内部导入
from app.shared.domain.constraints.base import Constraint


class ForeignKeyConstraints(Constraint):
    """
    @classdesc 外键约束

    验证数据列中的值是否在目标表的列中存在。
    通过值规范化处理，支持不同数据类型之间的匹配。
    """

    def __init__(self, from_table: str, from_column: str, to_table: str, to_column: str):
        """
        @methoddesc 初始化外键约束

        参数:
            from_table: 子表名（包含外键列的表）
            from_column: 子表中的外键列名
            to_table: 父表名（被引用的表）
            to_column: 父表中被引用的列名
        """
        self.from_table = from_table
        self.from_column = from_column
        self.to_table = to_table
        self.to_column = to_column

    def _get_description(self) -> str:
        """生成外键约束描述，格式为 "外键约束: from_table.from_column -> to_table.to_column"""
        return f"外键约束: {self.from_table}.{self.from_column} -> {self.to_table}.{self.to_column}"

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        """
        @methoddesc 执行外键验证

        参数:
            datasets: 数据集字典，键为表名，值为 pandas DataFrame
            **kwargs: 额外的关键字参数（本方法不使用）

        返回:
            验证结果字典，包含 errors（错误列表）和 info（约束信息）

        逻辑说明:
            1. 检查 from_table 和 to_table 是否都在数据集中
            2. 检查 from_column 和 to_column 是否存在于各自表中
            3. 对目标列（父表）的值进行规范化，生成有效键集合
            4. 对源列（子表）的值进行规范化，检查是否都在有效键集合中
            5. 为不存在的键生成错误记录
        """
        errors: list[dict[str, Any]] = []

        def _normalize_fk_value(value: Any) -> Any:
            """
            规范化外键值，统一不同数据类型的表示形式

            规则:
                - None、NaN、空字符串 -> None（跳过检查）
                - 字符串 -> 去除前后空格；"123.0" 转为 "123"
                - 布尔值 -> "True" 或 "False"
                - 整数 -> 字符串形式
                - 浮点数 -> 去掉末尾的 .0 后转字符串
                - 其他类型 -> 转字符串并去除空格

            参数:
                value: 原始值

            返回:
                规范化后的值，或 None（表示应跳过检查）
            """
            # 空值统一返回 None，空值不视为外键违规
            if value is None or (isinstance(value, float) and pd.isna(value)) or pd.isna(value):
                return None

            # 字符串: 去除前后空格，处理 "123.0" 形式
            if isinstance(value, str):
                s = value.strip()
                if s == "":
                    return None
                # 将 "123.0"、"123.00" 等规范化为 "123"；回归 D4: 同时支持负号,
                # 使 "-123.0" → "-123"(原正则 ^\d+\.0+$ 不匹配负号 → 与 float -123.0→"-123" 不等)。
                if re.match(r"^-?\d+\.0+$", s):
                    return s.split(".", 1)[0]
                return s

            # 布尔值转为字符串 "True" 或 "False"
            if isinstance(value, bool):
                return str(value)

            # 整数转为字符串
            if isinstance(value, int):
                return str(value)

            # 浮点数: 如果是整数形式（如 123.0），去掉 .0 后转字符串
            if isinstance(value, float):
                if value.is_integer():
                    return str(int(value))
                return str(value)

            # 回归 D4: Decimal 是项目一等类型(decimal data_type),应与 float 一致归一。
            # Decimal("123.0") 经 str() → "123.0",而 float 123.0 → "123",两者不等会误报。
            # Decimal 整数值去掉 .0,与 float 对齐。
            try:
                from decimal import Decimal

                if isinstance(value, Decimal):
                    # 整数值的 Decimal(如 Decimal("123.0")) 规整为整数串
                    if value == value.to_integral_value():
                        return str(int(value))
                    return str(value).strip()
            except (TypeError, ValueError):
                pass

            # 其他类型: 转字符串并去除空格
            s = str(value).strip()
            return s if s != "" else None

        # 检查两张表是否都在数据集中
        if self.from_table not in datasets or self.to_table not in datasets:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.from_table,
                    "column": self.from_column,
                    "message": f"外键约束失败: 表 '{self.from_table}' 或 '{self.to_table}' 不在提供的数据集中。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        from_df = datasets[self.from_table]
        to_df = datasets[self.to_table]

        # 检查两列是否存在于各自表中
        if self.from_column not in from_df.columns or self.to_column not in to_df.columns:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.from_table,
                    "column": self.from_column,
                    "message": f"外键约束失败: 列 '{self.from_column}' 或 '{self.to_column}' 在其对应的表中不存在。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        # 对目标列（父表）的值进行规范化，并去除空值，生成有效键集合
        normalized_target_series = to_df[self.to_column].map(_normalize_fk_value).dropna()
        valid_keys = set(normalized_target_series)

        # 对源列（子表）的值进行规范化
        normalized_keys = from_df[self.from_column].map(_normalize_fk_value)
        # 找出非空且不在有效键集合中的值
        invalid_mask = normalized_keys.notna() & (~normalized_keys.isin(valid_keys))
        invalid_rows = from_df[invalid_mask]

        # 为每个无效的外键值生成错误记录
        for row_tuple in invalid_rows[[self.from_column]].itertuples(index=True, name=None):
            index = row_tuple[0]
            key_to_check = row_tuple[1]
            row_index = int(index) if index is not None else 0
            errors.append(
                {
                    "error_type": "ForeignKeyViolation",
                    "table": self.from_table,
                    "row_index": row_index,
                    "column": self.from_column,
                    "value": key_to_check,
                    "message": f"外键冲突: 值 '{key_to_check}' 在目标表 '{self.to_table}' 的列 '{self.to_column}' 中不存在。",
                }
            )

        return {"errors": errors, "info": self.get_constraint_info()}
