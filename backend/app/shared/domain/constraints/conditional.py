"""
@fileoverview 条件约束模块

功能概述:
- 实现 ConditionalConstraint 类
- 实现条件逻辑: 当 A 条件满足时，B 列必须满足 C 条件
- 支持简单条件和复合条件 (AND/OR)

架构设计:
- 继承基类: 继承自 Constraint 抽象类
- 条件解析: 支持 DSL 字典和注册的条件函数
- 条件类型: not_null, greater_than, in, eq, neq 等

输入示例:
    # 约束配置 - 简单条件: 当 status="VIP" 时, credit_limit 必须 > 1000
    constraint1 = ConditionalConstraint(
        table="customers",
        if_column="status",
        if_value="VIP",
        then_column="credit_limit",
        then_condition={"operator": "greater_than", "value": 1000}
    )

    # 约束配置 - 复合条件: 当 (age >= 18 AND country="CN") 时, id_card 必须 not_null
    constraint2 = ConditionalConstraint(
        table="users",
        if_conditions=[
            {"column": "age", "operator": "greater_than", "value": 18},
            {"column": "country", "operator": "eq", "value": "CN"}
        ],
        if_logic="and",
        then_column="id_card",
        then_condition={"operator": "not_null"}
    )

    # 数据集输入
    datasets = {
        "customers": DataFrame({
            "id": [1, 2, 3],
            "status": ["VIP", "Normal", "VIP"],
            "credit_limit": [500, 2000, 800]  # 第1行和第3行不满足条件
        })
    }

输出示例:
    # 验证失败 (第1行 VIP 但 credit_limit=500, 第3行 VIP 但 credit_limit=800)
    {
        "errors": [
            {
                "error_type": "ConditionalViolation",
                "table": "customers",
                "row_index": 0,
                "value": {"status": "VIP", "credit_limit": 500},
                "message": "条件约束冲突: 当满足条件时, 'credit_limit' 的值 '500' 不满足要求 (满足DSL {'operator': 'greater_than', 'value': 1000})."
            }
        ],
        "info": {...}
    }

DSL 操作符说明:
    - not_null: 值不能为空
    - greater_than: 值必须大于 threshold
    - less_than: 值必须小于 threshold
    - in: 值必须在列表中
    - eq: 值必须等于指定值
    - neq: 值必须不等于指定值
"""

from __future__ import annotations

# 1. 标准库导入
from typing import Any, Callable

# 2. 第三方库导入
import pandas as pd

# 3. 项目内部导入
from app.shared.domain.constraints.base import Constraint
from app.shared.domain.constraints.condition_registry import CONDITION_REGISTRY


class ConditionalConstraint(Constraint):
    """
    @classdesc 条件约束

    实现"当满足某条件时，另一列必须满足某规则"的业务逻辑。
    支持两种触发条件模式:
        1. 简单条件: 当 if_column == if_value 时触发
        2. 复合条件: 当多个条件组合满足时触发（支持 AND/OR 逻辑）
    """

    def __init__(
        self,
        table: str,
        if_column: str = "",
        if_value: Any = None,
        then_column: str = "",
        then_condition: dict | str = None,
        if_conditions: list[dict] | None = None,
        if_logic: str = "and",
    ):
        """
        @methoddesc 初始化条件约束

        参数:
            table: 目标表名
            if_column: 简单条件模式下的触发列名（与 if_conditions 互斥）
            if_value: 简单条件模式下的触发值（与 if_conditions 互斥）
            then_column: 需要被验证的列名
            then_condition: 对 then_column 的验证要求，可以是:
                - 字典（DSL）: 如 {"operator": "greater_than", "value": 1000}
                - 字符串: 已注册的条件函数名，如 "is_not_empty"
            if_conditions: 复合条件列表，每个元素是条件字典，如:
                [{"column": "age", "operator": "greater_than", "value": 18}]
            if_logic: 复合条件的逻辑组合方式，"and" 或 "or"，默认为 "and"

        属性:
            _condition_func: 解析后的条件验证函数（Callable），在初始化时通过 _parse_condition() 生成
            _condition_str: 条件的可读描述字符串
        """
        self.table = table
        self.if_column = if_column
        self.if_value = if_value
        self.if_conditions = if_conditions or []
        self.if_logic = if_logic or "and"
        self.then_column = then_column
        self.then_condition_config = then_condition
        # 解析 then_condition，生成可执行的验证函数
        self._condition_func = self._parse_condition()
        # 生成条件的可读描述字符串
        self._condition_str = self._condition_to_string()

    def _parse_condition(self) -> Callable[[Any, dict[str, Any] | None], bool]:
        """
        @methoddesc 解析 then_condition，生成验证函数

        根据 then_condition 的类型（字典 DSL 或字符串函数名），
        生成并返回一个接收单个值、返回布尔结果的验证函数。

        返回:
            验证函数: Callable[[Any], bool]

        抛出:
            ValueError: 当 DSL 操作符不支持，或字符串函数名未注册时抛出
            TypeError: 当 then_condition 类型既不是字典也不是字符串时抛出
        """
        if isinstance(self.then_condition_config, dict):
            operator = self.then_condition_config.get("operator")
            ref_column = self.then_condition_config.get("ref_column")

            # 辅助函数：获取比较值（固定值或引用列）
            def _get_compared_value(x: Any, row: dict[str, Any] | None) -> Any:
                if ref_column and row is not None:
                    return row.get(ref_column)
                return self.then_condition_config.get("value")

            if operator == "not_null":
                return lambda x, row=None: pd.notna(x) and x != ""
            if operator == "greater_than":
                threshold = self.then_condition_config.get("value")

                def _safe_greater_than(x: Any, row: dict[str, Any] | None = None) -> bool:
                    compared = _get_compared_value(x, row) if ref_column else threshold
                    if pd.isna(x) or x == "":
                        return False
                    if compared is None or compared == "":
                        return False
                    try:
                        return x > compared
                    except Exception:
                        try:
                            return float(x) > float(compared)
                        except Exception:
                            return False

                return _safe_greater_than
            if operator == "in":
                values = self.then_condition_config.get("values", [])

                def _safe_in(x: Any, row: dict[str, Any] | None = None) -> bool:
                    if pd.isna(x) or x == "":
                        return False
                    try:
                        return x in values
                    except Exception:
                        return False

                return _safe_in
            if operator == "less_than":
                threshold = self.then_condition_config.get("value")

                def _safe_less_than(x: Any, row: dict[str, Any] | None = None) -> bool:
                    compared = _get_compared_value(x, row) if ref_column else threshold
                    if pd.isna(x) or x == "":
                        return False
                    if compared is None or compared == "":
                        return False
                    try:
                        return x < compared
                    except Exception:
                        try:
                            return float(x) < float(compared)
                        except Exception:
                            return False

                return _safe_less_than
            if operator == "eq":
                expected = self.then_condition_config.get("value")

                def _safe_eq(x: Any, row: dict[str, Any] | None = None) -> bool:
                    compared = _get_compared_value(x, row) if ref_column else expected
                    if pd.isna(x) and compared is None:
                        return True
                    return x == compared

                return _safe_eq
            if operator == "neq":
                expected = self.then_condition_config.get("value")

                def _safe_neq(x: Any, row: dict[str, Any] | None = None) -> bool:
                    compared = _get_compared_value(x, row) if ref_column else expected
                    if pd.isna(x) and compared is None:
                        return False
                    return x != compared

                return _safe_neq
            raise ValueError(f"不支持的DSL操作符: '{operator}'")

        if isinstance(self.then_condition_config, str):
            # 从全局注册表中查找已注册的条件函数
            if self.then_condition_config in CONDITION_REGISTRY:
                original = CONDITION_REGISTRY[self.then_condition_config]
                # 包装为兼容新签名 (value, row=None) 的函数
                return lambda x, row=None: original(x)
            raise ValueError(
                f"未注册的条件函数名: '{self.then_condition_config}'. 可用: {list(CONDITION_REGISTRY.keys())}"
            )

        raise TypeError(f"then_condition配置类型不支持: {type(self.then_condition_config)}")

    def _condition_to_string(self) -> str:
        """将 then_condition 转换为可读描述字符串"""
        if isinstance(self.then_condition_config, dict):
            return f"满足DSL {self.then_condition_config}"
        if isinstance(self.then_condition_config, str):
            return f"满足已注册的规则 '{self.then_condition_config}'"
        return "满足未知规则"

    def _get_description(self) -> str:
        """生成约束描述"""
        if self.if_conditions:
            return f"条件约束: {self.table} 当满足条件时 {self.then_column} 必须 {self._condition_str}"
        return f"条件约束: {self.table} 当 {self.if_column}={self.if_value} 时 {self.then_column} 必须 {self._condition_str}"

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        """
        @methoddesc 执行条件约束验证

        参数:
            datasets: 数据集字典，键为表名，值为 pandas DataFrame
            **kwargs: 额外的关键字参数（本方法不使用）

        返回:
            验证结果字典，包含 errors（错误列表）和 info（约束信息）

        逻辑说明:
            1. 检查目标表是否存在
            2. 检查 then_column 是否存在
            3. 根据条件模式（简单/复合）筛选触发行
            4. 对每个触发行检查 then_column 是否满足条件
            5. 为不满足条件的行生成错误记录
        """
        errors = []

        # 检查目标表是否存在
        if self.table not in datasets:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.then_column,
                    "message": f"条件约束失败: 表 '{self.table}' 不在数据集中。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        df = datasets[self.table]

        # 检查目标列是否存在
        if self.then_column not in df.columns:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.then_column,
                    "message": f"条件约束失败: 列 '{self.then_column}' 不在表 '{self.table}' 中。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        def _apply_if_condition(cond: dict) -> pd.Series:
            """
            将单个条件应用到 DataFrame，返回布尔 Series

            参数:
                cond: 条件字典，包含 column/operator/value/values 等字段

            返回:
                pandas Series，表示每行是否满足该条件

            抛出:
                KeyError: 当条件引用的列不存在时抛出
            """
            # 支持两种字段名: if_column（旧）和 column（新）
            col = cond.get("if_column") or cond.get("column") or ""
            op = cond.get("operator") or "eq"
            value = cond.get("value")
            values = cond.get("values", [])
            if col not in df.columns:
                raise KeyError(col)
            s = df[col]
            if op == "not_null":
                # 非空: 既不是 NaN 也不是空字符串
                return pd.notna(s) & (s != "")
            if op == "in":
                # 值在指定列表中
                return s.isin(values if isinstance(values, list) else [])
            if op == "greater_than":
                # 大于: 先转为数值再比较
                try:
                    threshold = float(value)
                    return pd.to_numeric(s, errors="coerce") > threshold
                except Exception:
                    return pd.Series([False] * len(df), index=df.index)
            if op == "neq":
                # 不等于
                return s != value
            if op == "less_than":
                # 小于: 先转为数值再比较
                try:
                    threshold = float(value)
                    return pd.to_numeric(s, errors="coerce") < threshold
                except Exception:
                    return pd.Series([False] * len(df), index=df.index)
            # 默认: 等于
            return s == value

        # ============================================================================
        # 筛选触发条件的行
        # ============================================================================
        if self.if_conditions:
            # 复合条件模式: 使用多个条件组合筛选
            try:
                masks = [_apply_if_condition(c) for c in self.if_conditions]
            except KeyError as e:
                missing = str(e).strip("'")
                errors.append(
                    {
                        "error_type": "ConstraintConfigError",
                        "table": self.table,
                        "column": missing,
                        "message": f"条件约束失败: 列 '{missing}' 不在表 '{self.table}' 中。",
                    }
                )
                return {"errors": errors, "info": self.get_constraint_info()}

            # 根据逻辑运算符组合多个条件的布尔掩码
            if self.if_logic == "or":
                # OR 逻辑: 任一条件满足即触发
                mask = masks[0].copy()
                for m in masks[1:]:
                    mask = mask | m
            else:
                # AND 逻辑: 所有条件都满足才触发
                mask = masks[0].copy()
                for m in masks[1:]:
                    mask = mask & m
            triggered_rows = df[mask]
        elif self.if_column:
            # 简单条件模式: 当 if_column == if_value 时触发
            if self.if_column not in df.columns:
                errors.append(
                    {
                        "error_type": "ConstraintConfigError",
                        "table": self.table,
                        "column": self.if_column,
                        "message": f"条件约束失败: 列 '{self.if_column}' 不在表 '{self.table}' 中。",
                    }
                )
                return {"errors": errors, "info": self.get_constraint_info()}
            triggered_rows = df[df[self.if_column] == self.if_value]
        else:
            # 无条件模式: if_conditions 为空且 if_column 未设置，对所有行触发 THEN 检查
            triggered_rows = df

        # ============================================================================
        # 检查触发的行是否满足 then 条件
        # ============================================================================
        for index, row in triggered_rows.to_dict("index").items():
            value_to_check = row[self.then_column]
            # 使用解析出的验证函数检查值
            # 如果配置了 ref_column，传入整行数据以支持列间比较
            ref_column = (
                self.then_condition_config.get("ref_column") if isinstance(self.then_condition_config, dict) else None
            )
            if ref_column:
                check_result = self._condition_func(value_to_check, row)
            else:
                check_result = self._condition_func(value_to_check)
            if not check_result:
                # 构建触发条件的信息，用于错误消息
                if_value_payload: dict[str, Any] = {}
                if self.if_conditions:
                    for c in self.if_conditions:
                        col = c.get("if_column") or c.get("column")
                        if col and col in row:
                            if_value_payload[col] = row[col]
                else:
                    if_value_payload[self.if_column] = self.if_value

                row_index = int(index) if index is not None else 0
                errors.append(
                    {
                        "error_type": "ConditionalViolation",
                        "table": self.table,
                        "row_index": row_index,
                        "value": {**if_value_payload, self.then_column: value_to_check},
                        "message": f"条件约束冲突: 当满足条件时, '{self.then_column}' 的值 '{value_to_check}' 不满足要求 ({self._condition_str}).",
                    }
                )

        return {"errors": errors, "info": self.get_constraint_info()}
