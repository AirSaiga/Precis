"""
@fileoverview 字符集校验器

功能概述:
- 验证数据是否符合指定的字符集编码要求
- 支持 ASCII、中文等多种字符集模式

架构设计:
- 委托模式: 将校验逻辑委托给 CharsetConstraint 模型类处理
- 复用机制: 使用基础校验器的错误格式化方法
- 临时表映射: 将 DataFrame 映射为临时表 "temp" 供约束模型使用
"""

import time

import pandas as pd

from app.shared.domain import CharsetConstraint

from ..types import ValidationResult
from .base import BaseValidator


class CharsetValidator(BaseValidator):
    """
    @classdesc 字符集校验器

    验证数据列中的值是否符合指定的字符集编码要求。
    支持 ASCII（纯英文字符）和中文（纯中文字符）两种模式。

    设计原则：
    - 委托设计：核心校验逻辑委托给 CharsetConstraint 模型
    - 统一接口：与其他校验器保持一致的 validate 方法签名
    """

    def validate(self, df: pd.DataFrame, column: str, **kwargs) -> ValidationResult:
        """
        @methoddesc 执行字符集校验

        校验 DataFrame 中指定列的数据是否符合指定的字符集编码要求。
        支持 ASCII（纯英文字符）和中文（纯中文字符）两种模式。

        参数:
            df: 待校验的 DataFrame 对象
            column: 待校验的列名
            **kwargs: 校验参数，包含:
                - charset_mode: 字符集模式，"ascii" 或 "chinese"（默认 "ascii"）

        返回:
            ValidationResult: 标准化校验结果
        """
        start_time = time.time()

        charset_mode = kwargs.get("charset_mode", "ascii")

        # 检查列是否存在
        if column not in df.columns:
            return ValidationResult(
                is_valid=False,
                error_count=1,
                total_rows=len(df),
                error_rows=[{"row_index": 0, "cell_value": None, "error_message": f"列 '{column}' 不存在"}],
                validation_time=f"{time.time() - start_time:.3f}s",
            )

        # 创建字符集约束对象并委托校验
        constraint = CharsetConstraint(table="temp", column=column, charset_mode=charset_mode)
        return self._delegate_validation(df, column, constraint)
