"""
@fileoverview 数据类型基类模块

功能概述:
- 定义数据类型抽象基类 (DataType)
- 所有具体数据类型都继承自此基类
- 提供统一的验证 (validate) 和解析 (parse) 接口

架构设计:
- 抽象基类: 使用 ABC 定义抽象方法
- 双重接口: validate() + parse()
- 子类必须实现两个抽象方法才能实例化

输入示例:
    # 子类使用
    class IntegerType(DataType):
        def validate(self, value): ...
        def parse(self, value): ...

输出示例:
    # validate(value: Any) -> Tuple[bool, Any]
    #   - 验证值是否符合类型要求
    #   - 返回: (是否有效, 错误信息)
    #   - 成功: (True, None)
    #   - 失败: (False, "错误描述")

    # parse(value: Any) -> Any
    #   - 将值转换为目标类型
    #   - 返回转换后的值

继承体系:
    DataType (抽象基类)
        ├── IntegerType     # 整数类型
        ├── StringType      # 字符串类型
        ├── FloatType       # 浮点数类型
        ├── BooleanType     # 布尔类型
        ├── ExpressionType  # 表达式类型
        ├── ExtractedType   # 提取类型
        ├── SequenceType    # 序列类型
        └── CompositeConditionType  # 复合条件类型
"""

from __future__ import annotations

# 1. 标准库导入
from abc import ABC, abstractmethod
from typing import Any

# 2. 第三方库导入
import pandas as pd


class DataType(ABC):
    """
    @classdesc 数据类型抽象基类

    所有具体数据类型的基类，定义统一的数据类型接口。
    子类必须实现 validate() 和 parse() 方法，否则无法实例化。

    使用场景:
    - 作为 IntegerType、StringType、FloatType 等具体类型的基类
    - 在 ColumnSchema 中定义列的数据类型
    - 在数据引擎 process_dataframe 中执行类型验证和转换
    """

    @abstractmethod
    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证值是否符合类型要求

        参数:
            value: 要验证的原始值

        返回:
            元组 (is_valid, error_message):
                - is_valid: True 表示验证通过，False 表示验证失败
                - error_message: 验证失败时的错误描述，验证通过时返回 None

        示例:
            >>> dtype = IntegerType()
            >>> dtype.validate(123)
            (True, None)
            >>> dtype.validate("abc")
            (False, "'abc' 不是一个严格格式的整数（只允许数字和可选的负号）。")
        """
        raise NotImplementedError

    @abstractmethod
    def parse(self, value: Any) -> Any:
        """
        @methoddesc 将值转换为目标类型

        参数:
            value: 要转换的原始值

        返回:
            转换后的目标类型值

        示例:
            >>> dtype = IntegerType()
            >>> dtype.parse("123")
            123
        """
        raise NotImplementedError

    def process_column(self, series: pd.Series, col_name: str, nullable: bool = True) -> tuple[pd.Series, list[dict]]:
        """
        @methoddesc 对整列数据进行验证和解析（向量化入口）

        子类可覆写此方法以提供更高效的向量化实现。
        默认实现使用逐元素调用 validate() + parse()。

        参数:
            series: 待处理的 pandas Series
            col_name: 列名（用于错误信息）
            nullable: 是否允许空值

        返回:
            (parsed_series, errors_list):
                - parsed_series: 解析后的 Series，无效位置为 None
                - errors_list: 错误字典列表，格式与 data_engine 一致
        """
        errors: list[dict] = []
        parsed_values: list[Any] = []
        is_na = series.isna()

        for index, value in series.items():
            # nullable 检查：当列配置为不允许为空时，拒绝空值
            if not nullable and (is_na[index] or str(value).strip() == ""):
                errors.append(
                    {
                        "row_index": index,
                        "column": col_name,
                        "value": value,
                        "error_type": "NotNullViolation",
                        "error_message": f"列 '{col_name}' 不允许为空",
                    }
                )
                parsed_values.append(None)
                continue

            if is_na[index]:
                parsed_values.append(None)
                continue

            is_valid, error_message = self.validate(value)
            if not is_valid:
                errors.append(
                    {
                        "row_index": index,
                        "column": col_name,
                        "value": value,
                        "error_type": "TypeValidationError",
                        "error_message": error_message,
                    }
                )
                parsed_values.append(None)
                continue

            parsed_values.append(self.parse(value))

        return pd.Series(parsed_values, index=series.index), errors
