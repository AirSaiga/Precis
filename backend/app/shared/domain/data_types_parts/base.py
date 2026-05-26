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

        子类必须实现此方法，对单个原始值进行类型合规性检查。
        验证逻辑应专注于格式和语义正确性，不涉及空值判断（空值由调用方处理）。

        Args:
            value: 要验证的原始值，可能为字符串、数字、日期对象等任意类型

        Returns:
            tuple[bool, Any]: 二元组，结构固定为 (is_valid, error_message)
                - is_valid (bool): True 表示值符合该数据类型的格式和语义要求；False 表示验证失败
                - error_message (Any): 验证失败时返回描述性错误信息（通常为 str）；验证通过时必须返回 None

        Raises:
            NotImplementedError: 抽象方法，直接调用基类方法会抛出此异常，强制子类实现

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

        子类必须实现此方法，将已通过 validate() 验证的原始值转换为该数据类型的标准 Python 对象。
        调用方应确保在调用 parse() 前先调用 validate() 确认值有效。

        Args:
            value: 要转换的原始值，通常为字符串或从数据源读取的原始格式

        Returns:
            Any: 转换后的目标类型值，如 int、float、datetime 对象等，具体类型由子类定义

        Raises:
            NotImplementedError: 抽象方法，直接调用基类方法会抛出此异常，强制子类实现

        示例:
            >>> dtype = IntegerType()
            >>> dtype.parse("123")
            123
        """
        raise NotImplementedError

    def process_column(self, series: pd.Series, col_name: str, nullable: bool = True) -> tuple[pd.Series, list[dict]]:
        """
        @methoddesc 对整列数据进行验证和解析（向量化入口）

        提供逐元素验证 + 解析的默认实现，作为子类覆写前的基线行为。
        处理流程按优先级分为四个分支：非空违反 -> 空值透传 -> 类型验证失败 -> 解析成功。
        子类可覆写此方法以提供更高效的向量化实现（如使用 pandas 的 apply/vectorized 操作）。

        Args:
            series: 待处理的 pandas Series，包含从数据源读取的原始列数据
            col_name: 列名，用于构造错误信息中的标识和描述
            nullable: 是否允许空值（None/NaN/空字符串）。False 表示该列不允许为空，遇到空值时记录 NotNullViolation 错误

        Returns:
            tuple[pd.Series, list[dict]]: 处理结果二元组
                - parsed_series (pd.Series): 解析后的 Series，索引与输入一致；验证失败或空值位置填充为 None
                - errors_list (list[dict]): 错误字典列表，每个字典包含 row_index、column、value、error_type、error_message，格式与 data_engine 保持一致
        """
        # 收集整列处理过程中发现的所有错误
        errors: list[dict] = []
        # 收集逐元素解析后的值，最终组装为新的 Series
        parsed_values: list[Any] = []
        # 预先计算整列的空值掩码，避免在循环中重复判断，提升性能
        is_na = series.isna()

        for index, value in series.items():
            # 分支 1：非空约束检查
            # 当 nullable=False 时，拒绝任何空值（pandas NaN 或空字符串）
            if not nullable and (is_na[index] or str(value).strip() == ""):
                errors.append(
                    {
                        "row_index": index,  # 数据行索引，与原始 DataFrame 对齐
                        "column": col_name,  # 当前处理的列名，用于定位错误位置
                        "value": value,  # 原始空值，保留用于调试和展示
                        "error_type": "NotNullViolation",  # 错误类型标识，与前端错误分类对应
                        "error_message": f"列 '{col_name}' 不允许为空",  # 面向用户的错误描述
                    }
                )
                # 非空违反时，解析结果置为 None，保持 Series 长度与索引一致
                parsed_values.append(None)
                # 进入下一个元素，跳过后续的 validate/parse
                continue

            # 分支 2：空值透传
            # 当列允许为空（nullable=True）且当前值为空时，直接透传 None，不执行类型验证
            if is_na[index]:
                parsed_values.append(None)
                continue

            # 分支 3：类型验证
            # 对非空值调用子类实现的 validate() 进行格式和语义检查
            is_valid, error_message = self.validate(value)
            if not is_valid:
                errors.append(
                    {
                        "row_index": index,
                        "column": col_name,
                        "value": value,  # 记录原始无效值，便于用户排查数据问题
                        "error_type": "TypeValidationError",  # 类型验证失败的统一错误标识
                        "error_message": error_message,  # 由具体子类提供的详细错误描述
                    }
                )
                # 验证失败时，解析结果置为 None，避免将无效数据流入下游处理
                parsed_values.append(None)
                continue

            # 分支 4：解析成功
            # 值已通过 validate() 验证，调用子类实现的 parse() 转换为目标类型
            parsed_values.append(self.parse(value))

        # 使用原始索引构建新的 Series，确保与输入 DataFrame 的行对齐
        return pd.Series(parsed_values, index=series.index), errors
