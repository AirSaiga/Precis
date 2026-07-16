"""
@fileoverview 标量数据类型模块

功能概述:
- 定义基础标量数据类型 (Integer, String, Float, Boolean 等)
- 实现数据类型验证和解析

架构设计:
- 继承基类: 所有类型继承自 DataType 基类
- validate: 验证值是否符合类型要求
- parse: 将值转换为目标类型

输入示例:
    # 验证各种类型的值
    values = [123, "hello", 3.14, True, "2024-01-01"]

    # IntegerType 验证
    IntegerType().validate(123)    # (True, None)
    IntegerType().validate("abc")  # (False, "不是整数")

    # StringType 验证
    StringType().validate("hello") # (True, None)
    StringType().validate(None)    # (False, "值不能为空")

    # FloatType 验证
    FloatType().validate(3.14)   # (True, None)
    FloatType().validate("abc")   # (False, "不是浮点数")

输出示例:
    # validate() 返回 (is_valid: bool, error_message: str | None)
    (True, None)           # 验证通过
    (False, "错误信息")     # 验证失败

    # parse() 返回转换后的值
    IntegerType().parse("123")    # 123 (int)
    StringType().parse(123)      # "123" (str)
    FloatType().parse("3.14")   # 3.14 (float)
"""

from __future__ import annotations

# 1. 标准库导入
import re
from typing import Any

# 2. 第三方库导入
import pandas as pd

# 3. 项目内部导入
from app.shared.domain.data_types_parts.base import DataType


class IntegerType(DataType):
    """
    @classdesc 整数类型

    验证和解析整数值。
    支持正整数、负整数和零，格式要求为纯数字（可选前导负号）。

    使用场景:
    - 用户 ID、订单号等整数字段
    - 年龄、数量等数值字段
    """

    _int_pattern = re.compile(r"^-?\d+$")

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证值是否为整数

        使用正则表达式匹配纯数字格式，并尝试转换为 int 类型。

        参数:
            value: 要验证的值

        返回:
            元组 (is_valid, error_message)
        """
        if value is None:
            return False, "值不能为空。"
        value_str = str(value)
        if self._int_pattern.fullmatch(value_str):
            try:
                int(value_str)
                return True, None
            except ValueError:
                return False, f"'{value_str}' 看起来像整数，但无法转换。"
        return False, f"'{value_str}' 不是一个严格格式的整数（只允许数字和可选的负号）。"

    def parse(self, value: Any) -> int:
        """
        @methoddesc 将值解析为整数

        参数:
            value: 要解析的值

        返回:
            整数
        """
        return int(value)

    def process_column(self, series: pd.Series, col_name: str, nullable: bool = True) -> tuple[pd.Series, list[dict]]:
        """向量化整数列验证和解析。"""
        errors: list[dict] = []
        is_na = series.isna()

        # nullable 检查
        if not nullable:
            blank_mask = series.fillna("").astype(str).str.strip() == ""
            notnull_violations = is_na | blank_mask
            for index in series.index[notnull_violations]:
                errors.append(
                    {
                        "row_index": index,
                        "column": col_name,
                        "value": series[index],
                        "error_type": "NotNullViolation",
                        "error_message": f"列 '{col_name}' 不允许为空",
                    }
                )
        else:
            notnull_violations = pd.Series(False, index=series.index)

        # 对非空值进行类型验证
        non_na = ~is_na & ~notnull_violations

        # 回归 #2 修复:含空值的整数列被 pandas 推断为 float64,str(1.0)="1.0" 不匹配整数正则,
        # 导致整列每个非空值误报 TypeValidationError。对"值是整数"的 float 在字符串化前回收为整数,
        # 避免把 1.5 这样的真实小数误判为整数(仅当 float.is_integer() 为真时规整)。
        def _to_int_str(v: Any) -> str:
            if isinstance(v, float) and v.is_integer():
                return str(int(v))
            return str(v)

        series_str = series.apply(_to_int_str)
        valid_format = series_str.str.fullmatch(r"^-?\d+$")

        # 标记类型验证失败的行
        type_error_mask = non_na & ~valid_format
        for index in series.index[type_error_mask]:
            val = series[index]
            errors.append(
                {
                    "row_index": index,
                    "column": col_name,
                    "value": val,
                    "error_type": "TypeValidationError",
                    "error_message": f"'{val}' 不是一个严格格式的整数（只允许数字和可选的负号）。",
                }
            )

        # 解析：用 pd.to_numeric 批量转换
        parsed = pd.to_numeric(series_str, errors="coerce")
        overflow_mask = non_na & parsed.notna() & (parsed.abs() > 2**53)
        for index in series.index[overflow_mask]:
            errors.append(
                {
                    "row_index": index,
                    "column": col_name,
                    "value": series[index],
                    "error_type": "TypeValidationError",
                    "error_message": f"'{series[index]}' 超出安全整数范围（±2^53），可能丢失精度。",
                }
            )
        # 将无效/空值位置设为 None
        failed = is_na | notnull_violations | type_error_mask | overflow_mask
        parsed = parsed.where(~failed, None)

        return parsed, errors


class StringType(DataType):
    """
    @classdesc 字符串类型

    验证值非空，并将其解析为字符串。
    最基本的类型，几乎所有字段都可以使用。

    使用场景:
    - 姓名、地址、描述等文本字段
    - 不需要特定格式验证的通用字段
    """

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证值是否非空

        参数:
            value: 要验证的值

        返回:
            元组 (is_valid, error_message)
        """
        if value is None:
            return False, "值不能为空。"
        return True, None

    def parse(self, value: Any) -> str:
        """
        @methoddesc 将值解析为字符串

        参数:
            value: 要解析的值

        返回:
            字符串
        """
        return str(value)

    def process_column(self, series: pd.Series, col_name: str, nullable: bool = True) -> tuple[pd.Series, list[dict]]:
        """向量化字符串列验证和解析。"""
        errors: list[dict] = []
        is_na = series.isna()

        # nullable 检查
        if not nullable:
            blank_mask = series.fillna("").astype(str).str.strip() == ""
            notnull_violations = is_na | blank_mask
            for index in series.index[notnull_violations]:
                errors.append(
                    {
                        "row_index": index,
                        "column": col_name,
                        "value": series[index],
                        "error_type": "NotNullViolation",
                        "error_message": f"列 '{col_name}' 不允许为空",
                    }
                )
        else:
            notnull_violations = pd.Series(False, index=series.index)

        # StringType 几乎不产生类型验证错误，直接转为字符串
        # 保留空值位置为 None
        failed = is_na | notnull_violations
        parsed = series.astype(str).where(~failed, None)

        return parsed, errors


class FloatType(DataType):
    """
    @classdesc 浮点数类型

    验证和解析浮点数值。
    支持整数形式和小数形式的数值。

    使用场景:
    - 价格、比率、测量值等需要小数精度的字段
    """

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证值是否为有效的浮点数

        尝试将值转换为 float 类型来验证。

        参数:
            value: 要验证的值

        返回:
            元组 (is_valid, error_message)
        """
        try:
            float(value)
            return True, None
        except (ValueError, TypeError):
            return False, f"'{value}' 不是一个有效的浮点数。"

    def parse(self, value: Any) -> float:
        """
        @methoddesc 将值解析为浮点数

        参数:
            value: 要解析的值

        返回:
            浮点数
        """
        return float(value)

    def process_column(self, series: pd.Series, col_name: str, nullable: bool = True) -> tuple[pd.Series, list[dict]]:
        """向量化浮点数列验证和解析。"""
        errors: list[dict] = []
        is_na = series.isna()

        # nullable 检查
        if not nullable:
            blank_mask = series.fillna("").astype(str).str.strip() == ""
            notnull_violations = is_na | blank_mask
            for index in series.index[notnull_violations]:
                errors.append(
                    {
                        "row_index": index,
                        "column": col_name,
                        "value": series[index],
                        "error_type": "NotNullViolation",
                        "error_message": f"列 '{col_name}' 不允许为空",
                    }
                )
        else:
            notnull_violations = pd.Series(False, index=series.index)

        # 用 pd.to_numeric 批量转换，coerce 将无效值转为 NaN
        parsed = pd.to_numeric(series, errors="coerce")

        # 标记类型验证失败的行（非空但转换后为 NaN）
        non_na = ~is_na & ~notnull_violations
        type_error_mask = non_na & parsed.isna()
        for index in series.index[type_error_mask]:
            val = series[index]
            errors.append(
                {
                    "row_index": index,
                    "column": col_name,
                    "value": val,
                    "error_type": "TypeValidationError",
                    "error_message": f"'{val}' 不是一个有效的浮点数。",
                }
            )

        # 将无效/空值位置设为 None
        failed = is_na | notnull_violations | type_error_mask
        parsed = parsed.where(~failed, None)

        return parsed, errors


class DecimalType(DataType):
    """
    @classdesc 高精度小数类型

    基于 Python Decimal 实现的高精度数值类型。
    支持精度（总有效数字位数）和小数位数限制。

    使用场景:
    - 货币金额计算（避免浮点数精度问题）
    - 需要精确小数表示的业务场景
    """

    def __init__(self, precision: int = 28, scale: int | None = None):
        """
        @methoddesc 初始化高精度小数类型

        参数:
            precision: 总精度（最大有效数字位数），默认 28
            scale: 小数位数限制，None 表示不限制
        """
        self.precision = precision
        self.scale = scale

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证值是否为有效的高精度小数

        检查值能否转换为 Decimal，以及是否满足精度和位数限制。

        参数:
            value: 要验证的值

        返回:
            元组 (is_valid, error_message)
        """
        from decimal import Decimal, InvalidOperation

        try:
            decimal_value = Decimal(str(value))
            if not decimal_value.is_finite():
                return False, f"'{value}' 不是有限的数值（NaN 或 Infinity 不被接受）"
            if self.precision:
                _sign, digits, _exponent = decimal_value.as_tuple()
                total_digits = len(digits)
                if total_digits > self.precision:
                    return False, f"'{value}' 超出精度限制（最大 {self.precision} 位）"
            if self.scale is not None:
                exponent = decimal_value.as_tuple().exponent
                if isinstance(exponent, int):
                    decimal_places = -exponent
                    if decimal_places > self.scale:
                        return False, f"'{value}' 小数位数超出限制（最大 {self.scale} 位）"
            return True, None
        except (InvalidOperation, ValueError, TypeError):
            return False, f"'{value}' 不是一个有效的数值。"

    def parse(self, value: Any):
        """
        @methoddesc 将值解析为 Decimal

        参数:
            value: 要解析的值

        返回:
            Decimal 对象
        """
        from decimal import Decimal

        return Decimal(str(value))


class BooleanType(DataType):
    """
    @classdesc 布尔类型

    验证和解析布尔值。
    支持多种布尔值表示形式，如 true/false、yes/no、1/0、是/否等。

    使用场景:
    - 开关、状态、标记等只有两种状态的字段
    """

    TRUE_VALUES = {"true", "yes", "on", "1", "是", "t", "y"}
    FALSE_VALUES = {"false", "no", "off", "0", "否", "f", "n"}

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证值是否为有效的布尔值

        支持布尔类型、字符串形式（大小写不敏感）等多种输入。

        参数:
            value: 要验证的值

        返回:
            元组 (is_valid, error_message)
        """
        if value is None:
            return False, "值不能为空。"

        if isinstance(value, bool):
            return True, None

        str_val = str(value).strip().lower()
        if str_val in self.TRUE_VALUES or str_val in self.FALSE_VALUES:
            return True, None

        return False, f"'{value}' 不是一个有效的布尔值。"

    def parse(self, value: Any) -> bool:
        """
        @methoddesc 将值解析为布尔值

        如果值在 TRUE_VALUES 集合中，返回 True；否则返回 False。

        参数:
            value: 要解析的值

        返回:
            布尔值
        """
        if isinstance(value, bool):
            return value

        str_val = str(value).strip().lower()
        return str_val in self.TRUE_VALUES

    def process_column(self, series: pd.Series, col_name: str, nullable: bool = True) -> tuple[pd.Series, list[dict]]:
        """向量化布尔列验证和解析。"""
        errors: list[dict] = []
        is_na = series.isna()

        # nullable 检查
        if not nullable:
            blank_mask = series.fillna("").astype(str).str.strip() == ""
            notnull_violations = is_na | blank_mask
            for index in series.index[notnull_violations]:
                errors.append(
                    {
                        "row_index": index,
                        "column": col_name,
                        "value": series[index],
                        "error_type": "NotNullViolation",
                        "error_message": f"列 '{col_name}' 不允许为空",
                    }
                )
        else:
            notnull_violations = pd.Series(False, index=series.index)

        # 对非空值进行类型验证
        non_na = ~is_na & ~notnull_violations
        is_python_bool = series.apply(lambda v: isinstance(v, bool))

        # 回归 #3 修复:0/1 布尔列带空值被 pandas 推断为 float64,"1.0"/"0.0" 不在合法布尔集合 →
        # 整列误报。对 is_integer() 为真的 float 在字符串化前回收为整数,使 1.0→"1"、0.0→"0" 命中合法集合。
        def _to_int_str(v: Any) -> str:
            if isinstance(v, float) and v.is_integer():
                return str(int(v))
            return str(v)

        series_str = series.apply(_to_int_str).str.strip().str.lower()
        is_true = series_str.isin(self.TRUE_VALUES)
        is_false = series_str.isin(self.FALSE_VALUES)
        valid_mask = is_python_bool | is_true | is_false

        # 标记类型验证失败的行
        type_error_mask = non_na & ~valid_mask
        for index in series.index[type_error_mask]:
            val = series[index]
            errors.append(
                {
                    "row_index": index,
                    "column": col_name,
                    "value": val,
                    "error_type": "TypeValidationError",
                    "error_message": f"'{val}' 不是一个有效的布尔值。",
                }
            )

        # 解析：逐行判定（布尔类型需要处理 Python bool + 字符串混合输入）
        result_values: list[Any] = []
        for i, val in series.items():
            if is_na[i] or notnull_violations[i] or type_error_mask[i]:
                result_values.append(None)
            elif isinstance(val, bool):
                result_values.append(val)
            else:
                # 回归 #3: float 1.0/0.0 需回收为整数再判定(与上面的字符串化规整保持一致)
                check_val = str(int(val)) if (isinstance(val, float) and val.is_integer()) else str(val)
                result_values.append(check_val.strip().lower() in self.TRUE_VALUES)
        parsed = pd.Series(result_values, index=series.index)

        return parsed, errors


class DateType(DataType):
    """
    @classdesc 日期类型

    验证和解析日期值。
    格式要求: YYYY-MM-DD

    使用场景:
    - 出生日期、订单日期、有效期等日期字段
    """

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证值是否为有效的日期格式

        使用 strptime 按照 YYYY-MM-DD 格式解析来验证。

        参数:
            value: 要验证的值

        返回:
            元组 (is_valid, error_message)
        """
        if value is None:
            return False, "值不能为空。"
        from datetime import datetime

        try:
            datetime.strptime(str(value), "%Y-%m-%d")
            return True, None
        except ValueError:
            return False, f"'{value}' 不是有效的日期格式 (YYYY-MM-DD)。"

    def parse(self, value: Any):
        """
        @methoddesc 将值解析为日期对象

        按照 YYYY-MM-DD 格式解析字符串并返回 date 对象。

        参数:
            value: 要解析的值

        返回:
            datetime.date 对象
        """
        from datetime import datetime

        return datetime.strptime(str(value), "%Y-%m-%d").date()

    def process_column(self, series: pd.Series, col_name: str, nullable: bool = True) -> tuple[pd.Series, list[dict]]:
        """向量化日期列验证和解析。"""
        errors: list[dict] = []
        is_na = series.isna()

        # nullable 检查
        if not nullable:
            blank_mask = series.fillna("").astype(str).str.strip() == ""
            notnull_violations = is_na | blank_mask
            for index in series.index[notnull_violations]:
                errors.append(
                    {
                        "row_index": index,
                        "column": col_name,
                        "value": series[index],
                        "error_type": "NotNullViolation",
                        "error_message": f"列 '{col_name}' 不允许为空",
                    }
                )
        else:
            notnull_violations = pd.Series(False, index=series.index)

        # 用 pd.to_datetime 批量解析
        non_na = ~is_na & ~notnull_violations
        parsed_dt = pd.to_datetime(series.astype(str), format="%Y-%m-%d", errors="coerce")

        # 标记类型验证失败的行
        type_error_mask = non_na & parsed_dt.isna()
        for index in series.index[type_error_mask]:
            val = series[index]
            errors.append(
                {
                    "row_index": index,
                    "column": col_name,
                    "value": val,
                    "error_type": "TypeValidationError",
                    "error_message": f"'{val}' 不是有效的日期格式 (YYYY-MM-DD)。",
                }
            )

        # 转换为 date 对象，保留原索引
        result_values: list[Any] = []
        for i in series.index:
            if is_na[i] or notnull_violations[i] or type_error_mask[i]:
                result_values.append(None)
            else:
                result_values.append(parsed_dt[i].date())
        parsed = pd.Series(result_values, index=series.index)

        return parsed, errors
