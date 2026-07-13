"""
@fileoverview 日期逻辑校验器

功能概述:
- 对日期类型数据进行逻辑校验和计算验证
- 支持日期比较(大于、小于、等于、范围)和日期计算(年龄、天数差)

架构设计:
- 委托模式: 将校验逻辑委托给 DateLogicConstraint 模型类处理
- 复用机制: 使用基础校验器的错误格式化方法
- 临时表映射: 将 DataFrame 映射为临时表 "temp" 供约束模型使用
"""

import time
from datetime import datetime

import pandas as pd

from app.shared.domain import DateLogicConstraint

from ..types import ValidationResult
from .base import BaseValidator


class DateLogicValidator(BaseValidator):
    """
    @classdesc 日期逻辑校验器

    对日期类型数据进行多种逻辑校验和计算验证：
    - 比较模式：验证日期与参考日期的大小关系（大于、小于、等于等）
    - 计算模式：验证日期计算结果是否符合预期（年龄、天数差等）

    设计原则：
    - 委托设计：核心校验逻辑委托给 DateLogicConstraint 模型
    - 统一接口：与其他校验器保持一致的 validate 方法签名
    """

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行日期逻辑校验

        对 DataFrame 中指定列的日期数据进行逻辑校验。
        支持两种模式：
        - compare（比较模式）：验证日期与参考日期的大小关系
        - calculation（计算模式）：验证日期计算结果（如年龄、天数差）

        参数:
            df: 待校验的 DataFrame 对象
            column: 待校验的日期列名
            **kwargs: 校验参数，包含:
                - logic_mode: 逻辑模式，"compare" 或 "calculation"（默认 "compare"）
                - compare_op: 比较操作符，"gt"/"lt"/"eq"/"gte"/"lte"/"range"（默认 "gt"）
                - reference_date: 参考日期字符串，比较模式下的区间起点（可选）
                - reference_column: 参考日期列名，比较模式下的区间起点（可选）
                - reference_date_end: 区间终点固定日期，仅 range 模式使用（可选）
                - reference_column_end: 区间终点列名，仅 range 模式使用（可选）
                - calculation_type: 计算类型，"age" 或 "days_diff"（默认 "age"）
                - target_value: 目标计算值（可选）
                - target_column: 目标计算列（可选）

        返回:
            ValidationResult: 标准化校验结果
        """
        start_time = time.time()

        # 提取校验参数
        logic_mode = kwargs.get("logic_mode", "compare")
        calculation_type = kwargs.get("calculation_type", "age")
        # compare_op 默认值随计算类型调整：
        # - age/compare 模式默认 gt（与历史行为一致）
        # - days_diff 模式默认 eq（旧代码硬编码 != 即等价于 eq 比较，保持向后兼容）
        compare_op = kwargs.get("compare_op")
        if compare_op is None:
            compare_op = "eq" if calculation_type == "days_diff" else "gt"
        reference_date = kwargs.get("reference_date")
        reference_column = kwargs.get("reference_column")
        reference_date_end = kwargs.get("reference_date_end")
        reference_column_end = kwargs.get("reference_column_end")
        target_value = kwargs.get("target_value")
        target_column = kwargs.get("target_column")

        # 检查校验列是否存在
        if column not in df.columns:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[{"row_index": 0, "cell_value": None, "error_message": f"列 '{column}' 不存在"}],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # 检查参考列是否存在
        if reference_column and reference_column not in df.columns:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[
                    {"row_index": 0, "cell_value": None, "error_message": f"参考列 '{reference_column}' 不存在"}
                ],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # range 模式下检查终点参考列是否存在
        if compare_op == "range" and reference_column_end and reference_column_end not in df.columns:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[
                    {"row_index": 0, "cell_value": None, "error_message": f"终点参考列 '{reference_column_end}' 不存在"}
                ],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # 校验逻辑模式是否合法
        if logic_mode not in ("compare", "calculation"):
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[
                    {"row_index": 0, "cell_value": None, "error_message": f"不支持的日期逻辑模式: {logic_mode}"}
                ],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # 校验计算模式下的目标值是否为有效数值
        if logic_mode == "calculation" and target_value is not None:
            try:
                if calculation_type == "age":
                    float(target_value)
                elif calculation_type == "days_diff":
                    int(target_value)
            except (ValueError, TypeError):
                type_name = "年龄" if calculation_type == "age" else "天数"
                return ValidationResult(
                    is_valid=False,
                    error_count=1,
                    total_rows=len(df),
                    error_rows=[
                        {
                            "row_index": 0,
                            "cell_value": None,
                            "error_message": f"无效的目标{type_name}值: {target_value}，应为数值",
                        }
                    ],
                    validation_time=f"{time.time() - start_time:.3f}s",
                )

        # 校验参考日期格式是否合法
        if reference_date and self._parse_date(str(reference_date)) is None:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[
                    {"row_index": 0, "cell_value": None, "error_message": f"无效的参考日期格式: {reference_date}"}
                ],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # range 模式下校验终点参考日期格式
        if compare_op == "range" and reference_date_end and self._parse_date(str(reference_date_end)) is None:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[
                    {
                        "row_index": 0,
                        "cell_value": None,
                        "error_message": f"无效的终点参考日期格式: {reference_date_end}",
                    }
                ],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # 预检查：向量化找出无法解析的日期。
        # 严格保持 DATE_FORMATS 顺序（%d/%m/%Y 在 %m/%d/%Y 之前——歧义日期优先按日/月解析）。
        # 对每种格式用 pd.to_datetime(errors="coerce") 尝试，取第一个非 NaT 结果。
        series = df[column]
        non_null_mask = series.notna() & (series != None)  # noqa: E711
        str_series = series[non_null_mask].astype(str).str.strip()

        # 逐格式解析：已解析的不再尝试后续格式（保持 DATE_FORMATS 优先级）
        parsed_mask = pd.Series(False, index=str_series.index)
        for fmt in self.DATE_FORMATS:
            remaining = ~parsed_mask
            if not remaining.any():
                break
            try:
                candidate = pd.to_datetime(str_series[remaining], format=fmt, errors="coerce")
                parsed_mask = parsed_mask | candidate.notna()
            except (ValueError, TypeError):
                continue

        # 未解析的即为无法解析的日期
        unparseable_idx = str_series.index[~parsed_mask]
        unparseable_errors = [
            {"row_index": idx, "value": str(series[idx]), "message": f"无法解析日期: {series[idx]}"}
            for idx in unparseable_idx
        ]

        # 如果存在无法解析的日期，直接返回错误结果
        if unparseable_errors:
            return self._format_errors(unparseable_errors, len(df), time.time() - start_time)

        # 创建日期逻辑约束对象并委托校验
        constraint = DateLogicConstraint(
            table="temp",
            column=column,
            logic_mode=logic_mode,
            compare_op=compare_op,
            reference_date=reference_date,
            reference_column=reference_column,
            reference_date_end=reference_date_end,
            reference_column_end=reference_column_end,
            calculation_type=calculation_type,
            target_value=target_value,
            target_column=target_column,
        )
        return self._delegate_validation(df, column, constraint)

    DATE_FORMATS = [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%Y年%m月%d日",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
    ]

    @classmethod
    def _parse_date(cls, date_str: str) -> datetime | None:
        """
        @methoddesc 解析日期字符串

        尝试使用预定义的多种日期格式解析字符串。

        参数:
            date_str: 日期字符串

        返回:
            解析成功的 datetime 对象，失败则返回 None
        """
        date_str = str(date_str).strip()
        for fmt in cls.DATE_FORMATS:
            try:
                return datetime.strptime(date_str, fmt)
            except ValueError:
                continue
        return None

    @staticmethod
    def _compare_dates(date1: datetime, date2: datetime, operator: str) -> bool:
        """
        @methoddesc 比较两个日期

        根据操作符比较两个日期对象的大小关系。
        注意：range 是区间语义，需要起点和终点两个边界，不能通过本二元方法表达。

        参数:
            date1: 第一个日期
            date2: 第二个日期
            operator: 操作符 (gt/lt/eq/gte/lte)

        返回:
            比较结果布尔值
        """
        if operator == "gt":
            return date1 > date2
        elif operator == "lt":
            return date1 < date2
        elif operator == "eq":
            return date1.date() == date2.date()
        elif operator == "gte":
            return date1 >= date2
        elif operator == "lte":
            return date1 <= date2
        elif operator == "range":
            return False
        return True

    @staticmethod
    def _get_operator_name(op: str) -> str:
        """
        @methoddesc 获取操作符的中文名称

        参数:
            op: 操作符字符串

        返回:
            操作符对应的中文描述
        """
        op_map = {"gt": "大于", "lt": "小于", "eq": "等于", "gte": "大于等于", "lte": "小于等于", "range": "在范围内"}
        return op_map.get(op, op)
