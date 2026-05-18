"""
@fileoverview 提取数据类型模块

功能概述:
- 定义提取类型 (ExtractedType)
- 用于从源列中通过正则提取的派生列
- 标记该列不是原始数据列，而是由其他列提取生成

架构设计:
- 继承基类: 继承自 DataType 基类
- 元数据存储: 存储 source_column 和 extract_key
- 直通验证: 提取列的值在提取时已经过正则验证，validate 始终返回通过

输入示例:
    # 从 email 列提取用户名
    extracted = ExtractedType(
        source_column="email",
        extract_key="username"
    )

    # email 原始值: "user@example.com"
    # 通过正则 (?P<username>[^@]+) 提取

输出示例:
    # validate() 始终返回 True (提取列的值已经被正则验证过)
    (True, None)

    # parse() 返回原始值
    "user@example.com"
"""

from __future__ import annotations

# 1. 标准库导入
from typing import Any

# 2. 项目内部导入
from app.shared.domain.data_types_parts.base import DataType


class ExtractedType(DataType):
    """
    @classdesc 提取类型

    用于从源列中通过正则提取的派生列。
    标记该列不是原始数据列，而是由其他列提取生成的。

    使用场景:
    - 定义从 email 中提取用户名的派生列
    - 标记通过正则捕获组提取的数据列
    """

    def __init__(self, source_column: str, extract_key: str):
        """
        @methoddesc 初始化提取类型

        参数:
            source_column: 源列名，数据从该列提取
            extract_key: 提取键，对应正则捕获组的名称
        """
        self.source_column = source_column
        self.extract_key = extract_key
        self.name = "Extracted"

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证提取值

        提取列的值在提取时已经过正则验证，因此始终返回通过。

        参数:
            value: 任意值

        返回:
            始终返回 (True, None)
        """
        return True, None

    def parse(self, value: Any) -> Any:
        """
        @methoddesc 解析提取值

        直接返回原始值，不做转换。

        参数:
            value: 原始值

        返回:
            原始值
        """
        return value
