"""
@fileoverview 日期逻辑约束模块

功能概述:
- 实现 DateLogicConstraint 类
- 支持日期比较和日期计算两种模式
- 用于验证日期列的逻辑正确性

架构设计:
- 继承基类: 继承自 Constraint 抽象类
- 两种模式:
  - compare: 日期比较 (大于/小于/等于某个日期)
  - calculation: 日期计算 (计算年龄、天数差等)

输入示例:
    # 约束配置 - 比较模式: 出生日期必须 > 1900-01-01
    constraint1 = DateLogicConstraint(
        table="users",
        column="birth_date",
        logic_mode="compare",
        compare_op="gt",
        reference_date="1900-01-01"
    )

    # 约束配置 - 比较模式: 结束日期必须 > 开始日期
    constraint2 = DateLogicConstraint(
        table="projects",
        column="end_date",
        logic_mode="compare",
        compare_op="gt",
        reference_column="start_date"
    )

    # 约束配置 - 计算模式: 年龄必须 >= 18
    constraint3 = DateLogicConstraint(
        table="users",
        column="birth_date",
        logic_mode="calculation",
        calculation_type="age",
        target_value=18,
        compare_op="gte"
    )

输出示例:
    # 比较模式验证失败
    {
        "errors": [
            {
                "error_type": "DateLogicViolation",
                "table": "users",
                "row_index": 0,
                "column": "birth_date",
                "value": "1850-01-01",
                "message": "日期逻辑约束冲突: 值 '1850-01-01' 不满足比较条件 (gt 1900-01-01)。"
            }
        ],
        "info": {...}
    }

比较操作符:
    - gt: 大于
    - gte: 大于等于
    - lt: 小于
    - lte: 小于等于
    - eq: 等于

计算类型:
    - age: 计算年龄 (当前日期 - 出生日期)
"""

from __future__ import annotations

# 1. 标准库导入
from typing import Any

# 2. 第三方库导入
import pandas as pd

# 3. 项目内部导入
from app.shared.domain.constraints.base import Constraint


class DateLogicConstraint(Constraint):
    """
    @classdesc 日期逻辑约束

    验证日期列的逻辑正确性，支持两种模式:
        1. 比较模式: 比较日期与参考日期/参考列的大小关系
        2. 计算模式: 基于日期进行计算（如年龄），再与目标值比较
    """

    def __init__(
        self,
        table: str,
        column: str,
        logic_mode: str = "compare",
        compare_op: str = "gt",
        reference_date: str | None = None,
        reference_column: str | None = None,
        reference_date_end: str | None = None,
        reference_column_end: str | None = None,
        calculation_type: str | None = None,
        target_value: int | float | str | None = None,
        target_column: str | None = None,
    ):
        """
        @methoddesc 初始化日期逻辑约束

        参数:
            table: 目标表名
            column: 目标日期列名
            logic_mode: 逻辑模式，"compare"（比较）或 "calculation"（计算）
            compare_op: 比较操作符，可选 gt/gte/lt/lte/eq/range
            reference_date: 参考日期字符串（比较模式下使用，作为区间起点）
            reference_column: 参考列名（比较模式下使用，与 reference_date 互斥，作为区间起点）
            reference_date_end: 区间终点固定日期（仅 range 模式下使用）
            reference_column_end: 区间终点列名（仅 range 模式下使用）
            calculation_type: 计算类型（计算模式下使用），如 "age" 或 "days_diff"
            target_value: 目标值（计算模式下使用），用于与计算结果比较
            target_column: 目标参考列（计算模式下 days_diff 使用）
        """
        self.table = table
        self.column = column
        self.logic_mode = logic_mode
        self.compare_op = compare_op
        self.reference_date = reference_date
        self.reference_column = reference_column
        self.reference_date_end = reference_date_end
        self.reference_column_end = reference_column_end
        self.calculation_type = calculation_type
        self.target_value = target_value
        self.target_column = target_column

    def _get_description(self) -> str:
        """生成约束描述"""
        desc = f"日期逻辑约束: {self.table}.{self.column}"
        if self.logic_mode == "compare":
            if self.compare_op == "range":
                start = self.reference_column or self.reference_date
                end = self.reference_column_end or self.reference_date_end
                desc += f" range [{start}, {end}]"
            else:
                ref = self.reference_column or self.reference_date
                desc += f" {self.compare_op} {ref}"
        elif self.logic_mode == "calculation":
            desc += f" {self.calculation_type} check"
        return desc

    def _resolve_compare_boundary(
        self,
        df: pd.DataFrame,
        date_attr: str,
        column_attr: str,
        boundary_name: str = "",
    ) -> tuple[Any, list[dict[str, Any]]]:
        """解析比较模式下的一个边界值（固定日期或列）。

        返回:
            (边界值, 错误列表)。若存在错误，边界值为 None。
        """
        errors: list[dict[str, Any]] = []
        date_value = getattr(self, date_attr)
        column_value = getattr(self, column_attr)
        name_prefix = f"{boundary_name}" if boundary_name else ""

        if column_value:
            if column_value not in df.columns:
                errors.append(
                    {
                        "error_type": "ConstraintConfigError",
                        "table": self.table,
                        "column": column_value,
                        "message": f"日期逻辑约束失败: {name_prefix}参考列 '{column_value}' 不在表 '{self.table}' 中。",
                    }
                )
                return None, errors
            return pd.to_datetime(df[column_value], errors="coerce"), errors

        if date_value:
            parsed = pd.to_datetime(date_value, errors="coerce")
            if pd.isna(parsed):
                errors.append(
                    {
                        "error_type": "ConstraintConfigError",
                        "table": self.table,
                        "message": f"日期逻辑约束失败: 无效的{name_prefix}参考日期 '{date_value}'。",
                    }
                )
                return None, errors
            return parsed, errors

        return None, errors

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        """
        @methoddesc 执行日期逻辑验证

        参数:
            datasets: 数据集字典，键为表名，值为 pandas DataFrame
            **kwargs: 额外的关键字参数（本方法不使用）

        返回:
            验证结果字典，包含 errors（错误列表）和 info（约束信息）
        """
        errors: list[dict[str, Any]] = []

        # 检查目标表是否存在
        if self.table not in datasets:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "message": f"日期逻辑约束失败: 表 '{self.table}' 不在数据集中。",
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
                    "message": f"日期逻辑约束失败: 列 '{self.column}' 不在表 '{self.table}' 中。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        # 将目标列转换为 pandas 日期时间类型，无法转换的变为 NaT（Not a Time）
        target_series = pd.to_datetime(df[self.column], errors="coerce")

        # ============================================================================
        # 比较模式: 比较日期与参考值
        # ============================================================================
        if self.logic_mode == "compare":
            start_values, start_errors = self._resolve_compare_boundary(df, "reference_date", "reference_column")
            if start_errors:
                errors.extend(start_errors)
                return {"errors": errors, "info": self.get_constraint_info()}

            # range 模式需要单独解析终点边界
            if self.compare_op == "range":
                start_is_date = bool(self.reference_date)
                end_is_date = bool(self.reference_date_end)
                if start_values is None or (start_is_date != end_is_date):
                    errors.append(
                        {
                            "error_type": "ConstraintConfigError",
                            "table": self.table,
                            "column": self.column,
                            "message": "日期逻辑约束失败: range 模式必须同时指定起点和终点，且两者类型一致（同为固定日期或同为列引用）。",
                        }
                    )
                    return {"errors": errors, "info": self.get_constraint_info()}

                end_values, end_errors = self._resolve_compare_boundary(
                    df, "reference_date_end", "reference_column_end", "终点"
                )
                if end_errors:
                    errors.extend(end_errors)
                    return {"errors": errors, "info": self.get_constraint_info()}
                if end_values is None:
                    errors.append(
                        {
                            "error_type": "ConstraintConfigError",
                            "table": self.table,
                            "column": self.column,
                            "message": "日期逻辑约束失败: range 模式必须指定终点（reference_date_end 或 reference_column_end）。",
                        }
                    )
                    return {"errors": errors, "info": self.get_constraint_info()}

                # 创建有效值掩码: 目标值、起点、终点都必须是非空的有效日期
                mask_valid = target_series.notna()
                if isinstance(start_values, pd.Series):
                    mask_valid &= start_values.notna()
                if isinstance(end_values, pd.Series):
                    mask_valid &= end_values.notna()

                # 闭区间: start <= value <= end
                mask_fail = pd.Series(False, index=df.index, dtype=bool)
                if not isinstance(start_values, pd.Series) and not isinstance(end_values, pd.Series):
                    mask_fail[mask_valid] = ~(
                        (target_series[mask_valid] >= start_values) & (target_series[mask_valid] <= end_values)
                    )
                elif isinstance(start_values, pd.Series) and not isinstance(end_values, pd.Series):
                    mask_fail[mask_valid] = ~(
                        (target_series[mask_valid] >= start_values[mask_valid])
                        & (target_series[mask_valid] <= end_values)
                    )
                elif not isinstance(start_values, pd.Series) and isinstance(end_values, pd.Series):
                    mask_fail[mask_valid] = ~(
                        (target_series[mask_valid] >= start_values)
                        & (target_series[mask_valid] <= end_values[mask_valid])
                    )
                else:
                    mask_fail[mask_valid] = ~(
                        (target_series[mask_valid] >= start_values[mask_valid])
                        & (target_series[mask_valid] <= end_values[mask_valid])
                    )

                # 收集失败的行并生成错误记录
                failed_indices = df.index[mask_fail]
                for idx in failed_indices:
                    val = df.at[idx, self.column]
                    start_val = df.at[idx, self.reference_column] if self.reference_column else self.reference_date
                    end_val = (
                        df.at[idx, self.reference_column_end] if self.reference_column_end else self.reference_date_end
                    )
                    errors.append(
                        {
                            "error_type": "DateLogicError",
                            "table": self.table,
                            "row_index": int(idx),
                            "column": self.column,
                            "value": str(val),
                            "message": f"日期范围校验失败: {val} 不在 [{start_val}, {end_val}] 范围内",
                        }
                    )
            else:
                # 非 range 模式沿用单边界逻辑
                if start_values is None:
                    errors.append(
                        {
                            "error_type": "ConstraintConfigError",
                            "table": self.table,
                            "message": "日期逻辑约束失败: 比较模式必须指定 reference_column 或 reference_date。",
                        }
                    )
                    return {"errors": errors, "info": self.get_constraint_info()}

                ref_values = start_values

                # 创建有效值掩码: 目标值和参考值都必须是非空的有效日期
                mask_valid = target_series.notna()
                if isinstance(ref_values, pd.Series):
                    mask_valid &= ref_values.notna()

                # 初始化失败掩码（全 False）
                mask_fail = pd.Series(False, index=df.index, dtype=bool)

                # 根据比较操作符判断哪些行不满足条件
                # ~ 表示取反，即"不满足比较条件"
                if self.compare_op == "gt":
                    mask_fail[mask_valid] = ~(
                        target_series[mask_valid] > ref_values
                        if not isinstance(ref_values, pd.Series)
                        else target_series[mask_valid] > ref_values[mask_valid]
                    )
                elif self.compare_op == "lt":
                    mask_fail[mask_valid] = ~(
                        target_series[mask_valid] < ref_values
                        if not isinstance(ref_values, pd.Series)
                        else target_series[mask_valid] < ref_values[mask_valid]
                    )
                elif self.compare_op == "gte":
                    mask_fail[mask_valid] = ~(
                        target_series[mask_valid] >= ref_values
                        if not isinstance(ref_values, pd.Series)
                        else target_series[mask_valid] >= ref_values[mask_valid]
                    )
                elif self.compare_op == "lte":
                    mask_fail[mask_valid] = ~(
                        target_series[mask_valid] <= ref_values
                        if not isinstance(ref_values, pd.Series)
                        else target_series[mask_valid] <= ref_values[mask_valid]
                    )
                elif self.compare_op == "eq":
                    mask_fail[mask_valid] = ~(
                        target_series[mask_valid] == ref_values
                        if not isinstance(ref_values, pd.Series)
                        else target_series[mask_valid] == ref_values[mask_valid]
                    )
                else:
                    errors.append(
                        {
                            "error_type": "ConstraintConfigError",
                            "table": self.table,
                            "column": self.column,
                            "message": f"日期逻辑约束失败: 不支持比较操作符 '{self.compare_op}'，支持的操作符为 gt/gte/lt/lte/eq/range。",
                        }
                    )
                    return {"errors": errors, "info": self.get_constraint_info()}

                # 收集失败的行并生成错误记录
                failed_indices = df.index[mask_fail]
                for idx in failed_indices:
                    val = df.at[idx, self.column]
                    ref_val = df.at[idx, self.reference_column] if self.reference_column else self.reference_date
                    errors.append(
                        {
                            "error_type": "DateLogicError",
                            "table": self.table,
                            "row_index": int(idx),
                            "column": self.column,
                            "value": str(val),
                            "message": f"日期比较失败: {val} 应该 {self.compare_op} {ref_val}",
                        }
                    )

        # ============================================================================
        # 计算模式: 基于日期进行计算
        # ============================================================================
        elif self.logic_mode == "calculation":
            if self.calculation_type == "age":
                # 年龄计算: 计算从出生日期到参考日期的年龄
                ref_date = pd.Timestamp.now()
                if self.reference_date:
                    ref_date = pd.to_datetime(self.reference_date, errors="coerce")

                if pd.isna(ref_date):
                    errors.append(
                        {
                            "error_type": "ConstraintConfigError",
                            "table": self.table,
                            "message": "日期计算模式失败: 无效的参考日期。",
                        }
                    )
                    return {"errors": errors, "info": self.get_constraint_info()}

                # 只处理非空日期
                mask_valid = target_series.notna()

                def calculate_age(born):
                    """计算年龄: 年份差，再根据是否过生日调整"""
                    if pd.isna(born):
                        return None
                    # 年份相减，如果还没到今年的生日则再减1
                    return ref_date.year - born.year - ((ref_date.month, ref_date.day) < (born.month, born.day))

                # 对有效日期计算年龄
                ages = target_series[mask_valid].apply(calculate_age)

                # 与目标值比较
                if self.target_value is not None:
                    try:
                        target_age = float(self.target_value)
                        op = self.compare_op or "gte"
                        if op == "gt":
                            mask_fail_local = ages <= target_age
                        elif op == "lt":
                            mask_fail_local = ages >= target_age
                        elif op == "lte":
                            mask_fail_local = ages > target_age
                        elif op == "eq":
                            mask_fail_local = ages != target_age
                        else:
                            mask_fail_local = ages < target_age
                        op_desc = {"gt": "大于", "lt": "小于", "gte": "大于等于", "lte": "小于等于", "eq": "等于"}.get(
                            op, "大于等于"
                        )
                        failed_indices = mask_fail_local[mask_fail_local].index
                        for idx in failed_indices:
                            val = df.at[idx, self.column]
                            age = ages[idx]
                            errors.append(
                                {
                                    "error_type": "DateLogicError",
                                    "table": self.table,
                                    "row_index": int(idx),
                                    "column": self.column,
                                    "value": str(val),
                                    "message": f"年龄检查失败: {val} (年龄 {age}) 不满足条件 ({op_desc} {target_age})",
                                }
                            )
                    except ValueError as e:
                        errors.append(
                            {
                                "error_type": "ConstraintConfigError",
                                "table": self.table,
                                "column": self.column,
                                "message": f"target_value 转换失败: '{self.target_value}' 无法转换为数值 - {str(e)}",
                            }
                        )

            elif self.calculation_type == "days_diff":
                # 天数差计算: 计算两个日期列之间的天数差
                if self.target_column and self.target_column not in df.columns:
                    errors.append(
                        {
                            "error_type": "ConstraintConfigError",
                            "table": self.table,
                            "column": self.target_column,
                            "message": f"日期计算模式失败: 参考列 '{self.target_column}' 不在表 '{self.table}' 中。",
                        }
                    )
                    return {"errors": errors, "info": self.get_constraint_info()}

                mask_valid = target_series.notna()

                if self.target_column:
                    # 将参考列也转为日期类型
                    ref_series = pd.to_datetime(df[self.target_column], errors="coerce")
                    # 双方都必须有效
                    mask_valid &= ref_series.notna()

                    # 计算天数差的绝对值
                    diff_days = (target_series[mask_valid] - ref_series[mask_valid]).abs().dt.days

                    # 与目标值比较（接入 compare_op，过去硬编码 != 导致只能严格等于）
                    if self.target_value is not None:
                        try:
                            expected_diff = int(self.target_value)
                            # 与 age 分支保持一致的比较语义
                            op = self.compare_op or "eq"
                            if op == "gt":
                                mask_fail_local = diff_days <= expected_diff
                            elif op == "lt":
                                mask_fail_local = diff_days >= expected_diff
                            elif op == "gte":
                                mask_fail_local = diff_days < expected_diff
                            elif op == "lte":
                                mask_fail_local = diff_days > expected_diff
                            elif op == "eq":
                                mask_fail_local = diff_days != expected_diff
                            else:
                                # 未知 op 回退到 eq 语义（与 age 分支一致）
                                mask_fail_local = diff_days != expected_diff
                            op_desc = {
                                "gt": "大于",
                                "lt": "小于",
                                "gte": "大于等于",
                                "lte": "小于等于",
                                "eq": "等于",
                            }.get(op, "等于")
                            failed_indices = mask_fail_local[mask_fail_local].index
                            for idx in failed_indices:
                                val = df.at[idx, self.column]
                                ref_val = df.at[idx, self.target_column]
                                actual = diff_days[idx]
                                errors.append(
                                    {
                                        "error_type": "DateLogicError",
                                        "table": self.table,
                                        "row_index": int(idx),
                                        "column": self.column,
                                        "value": str(val),
                                        "message": f"天数差计算结果与目标不符: {val} vs {ref_val}，要求 {op_desc} {expected_diff} 天，实际 {actual} 天",
                                    }
                                )
                        except ValueError as e:
                            errors.append(
                                {
                                    "error_type": "ConstraintConfigError",
                                    "table": self.table,
                                    "column": self.column,
                                    "message": f"target_value 转换失败: '{self.target_value}' 无法转换为整数 - {str(e)}",
                                }
                            )

        return {"errors": errors, "info": self.get_constraint_info()}
