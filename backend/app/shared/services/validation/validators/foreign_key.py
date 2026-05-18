"""
@fileoverview 外键校验器 - Foreign Key Validator

功能概述:
- 验证数据列中的值是否存在于目标表的目标列中
- 支持引用完整性校验,确保外键关系的有效性
- 支持通过 target_values 传入目标数据集进行比对

架构设计:
- 组合模式: 结合 ForeignKeyConstraints 实现约束验证
- 数据集映射: 将当前 DataFrame 和目标数据映射为虚拟表进行比对
- 错误标准化: 复用基类的错误格式化逻辑

输入示例:
    df = pd.DataFrame({"user_id": [1, 2, 3, 99, 5]})
    target_values = [1, 2, 3, 4, 5]

输出示例:
    ValidationResult(
        is_valid=False,
        error_count=1,
        total_rows=5,
        error_rows=[
            {"row_index": 3, "cell_value": 99,
             "error_message": "外键值 99 在目标表中不存在"}
        ],
        validation_time="0.001s"
    )
"""

import time

import pandas as pd

from app.shared.domain import ForeignKeyConstraints

from ..types import ValidationResult
from .base import BaseValidator


class ForeignKeyValidator(BaseValidator):
    """
    @classdesc 外键校验器

    验证列中的所有值是否在目标表的指定列中存在，确保数据引用完整性。
    常用于校验关联 ID 的有效性，如用户 ID、订单 ID 等。

    为什么需要这个校验器？
    - 用于验证外键引用的完整性
    - 常见场景：订单表中的 user_id 必须在用户表中存在
    - 支持灵活的目标数据指定

    设计原则：
    - 引用完整性：确保外键值必须在目标表中存在
    - 配置驱动：通过 kwargs 配置目标表和目标列
    - 灵活数据源：支持通过 target_values 传入目标数据集

    示例：
        validator = ForeignKeyValidator()
        result = validator.validate(
            df, "user_id",
            target_table="users",
            target_column="id",
            target_values=[1, 2, 3, 4, 5]
        )
    """

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行外键校验

        校验 DataFrame 中指定列的值是否在目标表的对应列中存在,
        返回标准化的校验结果。

        @param df: 待校验的 DataFrame 对象
        @param column: 待校验的列名(外键列)
        @param kwargs: 校验参数:
            - target_table: 目标表名称(字符串)
            - target_column: 目标列名称(字符串)
            - target_values: 目标列的值列表(List[Any])

        @return ValidationResult: 标准化校验结果,包含:
            - is_valid: 校验是否通过
            - error_count: 错误行数(外键不存在的行)
            - total_rows: 总行数
            - error_rows: 错误详情列表

        @sideeffect:
            - 读取 DataFrame 列数据
            - 创建临时 ForeignKeyConstraints 对象
            - 可能抛出 ValueError(列不存在等)

        @raises ValueError: 列名不存在或配置不完整

        处理流程:
            Step 1: 初始化计时器,记录校验开始时间
            Step 2: 获取并验证目标表/列配置
            Step 3: 检查校验列是否存在于 DataFrame
            Step 4: 构建虚拟数据集(当前表和目标表)
            Step 5: 执行外键约束验证
            Step 6: 格式化错误结果并返回
        """
        # Step 1: 记录校验开始时间
        start_time = time.time()

        # Step 2: 获取目标表和目标列配置
        target_table = kwargs.get("target_table")
        target_column = kwargs.get("target_column")

        # 验证配置完整性,缺少必需参数则返回错误
        if not target_table or not target_column:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[{"row_index": 0, "cell_value": None, "error_message": "外键校验缺少目标表或目标列配置"}],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # Step 3: 验证校验列是否存在于 DataFrame
        if column not in df.columns:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[{"row_index": 0, "cell_value": None, "error_message": f"列 '{column}' 不存在"}],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # Step 4: 构建外键约束对象,映射虚拟表
        # 创建临时表名映射:"temp" -> 当前 DataFrame, "target" -> 目标数据
        constraint = ForeignKeyConstraints(
            from_table="temp", from_column=column, to_table="target", to_column=target_column
        )

        # 从 kwargs 获取目标值,构建目标 DataFrame
        target_df = pd.DataFrame({target_column: kwargs.get("target_values", [])})
        # 构建数据集字典,用于约束验证
        datasets = {"temp": df, "target": target_df}

        # 委托给基类的通用委托方法执行校验
        return self._delegate_validation(df, column, constraint, datasets=datasets)
