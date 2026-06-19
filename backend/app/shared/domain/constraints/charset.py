"""
@fileoverview 字符集约束模块

功能概述:
- 实现 CharsetConstraint 类
- 验证指定列的值是否符合指定的字符集编码要求
- 支持 ASCII 和中文两种模式

架构设计:
- 继承基类: 继承自 Constraint 抽象类
- 模式匹配: 针对不同字符集模式实现专用检测方法
- Unicode 范围: 使用 Unicode 码点范围判断字符类型

输入示例:
    # 约束配置
    constraint = CharsetConstraint(
        table="users",
        column="username",
        charset_mode="ascii"  # 或 "chinese"
    )

    # 数据集输入
    datasets = {
        "users": DataFrame({
            "id": [1, 2, 3],
            "username": ["alice", "bob", "张三"]  # "张三" 不符合 ASCII
        })
    }

输出示例:
    # 验证通过
    {
        "errors": [],
        "info": {
            "constraint_type": "CharsetConstraint",
            "table": "users",
            "description": "字符集约束: users.username (ASCII)"
        }
    }

    # 验证失败 (第3行 username 为中文)
    {
        "errors": [
            {
                "error_type": "CharsetViolation",
                "table": "users",
                "row_index": 2,
                "column": "username",
                "value": "张三",
                "message": "字符集约束冲突: 值 '张三' 包含非ASCII字符。"
            }
        ],
        "info": {...}
    }
"""

from __future__ import annotations

# 1. 标准库导入
from typing import Any

# 2. 第三方库导入
import pandas as pd

# 3. 项目内部导入
from app.shared.domain.constraints.base import Constraint


class CharsetConstraint(Constraint):
    """
    @classdesc 字符集约束

    验证数据列中的值是否符合指定的字符集编码要求。
    支持 ASCII(纯英文字符)、中文(纯中文字符)和中文混合(CJK + ASCII 字母/数字/常见标点)三种模式。

    业务场景:
    - 用户名、账号等字段要求纯 ASCII 字符
    - 姓名、地址等字段要求纯中文字符
    - 说明、备注等字段允许中文与英文数字及常见标点混合
    """

    # 中文混合模式下允许的 ASCII 常见标点符号
    _CHINESE_MIXED_PUNCTUATION = frozenset(" .,;:!?()[]{}'\"`-_/\\@#$%&*+=<>|~^")

    def __init__(self, table: str, column: str, charset_mode: str = "ascii", description: str | None = None):
        """
        @methoddesc 初始化字符集约束

        参数:
            table: 目标表名
            column: 目标列名
            charset_mode: 字符集模式，可选 "ascii" 或 "chinese"，默认为 "ascii"
            description: 自定义描述信息，可选
        """
        self.table = table
        self.column = column
        self.charset_mode = charset_mode
        self.description = description

    def _get_description(self) -> str:
        """根据字符集模式生成描述字符串"""
        if self.description:
            return self.description
        charset_name_map = {
            "ascii": "ASCII",
            "chinese": "中文",
            "chinese_mixed": "中文混合",
        }
        charset_name = charset_name_map.get(self.charset_mode, "未知")
        return f"字符集约束: {self.table}.{self.column} ({charset_name})"

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        """
        @methoddesc 执行字符集验证

        参数:
            datasets: 数据集字典，键为表名，值为 pandas DataFrame
            **kwargs: 额外的关键字参数（本方法不使用）

        返回:
            验证结果字典，包含 errors（错误列表）和 info（约束信息）

        逻辑说明:
            1. 检查目标表是否存在
            2. 检查目标列是否存在
            3. 遍历该列的每个非空值
            4. 调用 _check_charset() 检查值是否符合指定字符集
            5. 为每个不符合的值生成错误记录
        """
        errors: list[dict[str, Any]] = []

        # 检查目标表是否存在
        if self.table not in datasets:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.column,
                    "message": f"字符集约束失败: 表 '{self.table}' 不在数据集中。",
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
                    "message": f"字符集约束失败: 列 '{self.column}' 在表 '{self.table}' 中不存在。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        # 根据模式确定显示名称（用于错误消息）
        charset_name_map = {
            "ascii": "ASCII",
            "chinese": "中文",
            "chinese_mixed": "中文混合",
        }
        charset_name = charset_name_map.get(self.charset_mode, self.charset_mode)

        # 遍历该列所有值，逐行检查
        for row_tuple in df[[self.column]].itertuples(index=True, name=None):
            index = row_tuple[0]
            cell_value = row_tuple[1]

            # 跳过空值（NaN 或 None），空值不视为字符集违规
            if pd.isna(cell_value) or cell_value is None:
                continue

            # 将值转换为字符串进行检查
            cell_value_str = str(cell_value)
            if not cell_value_str:
                continue

            # 检查是否符合指定字符集
            is_valid = self._check_charset(cell_value_str, self.charset_mode)
            if not is_valid:
                errors.append(
                    {
                        "error_type": "CharsetViolation",
                        "table": self.table,
                        "row_index": int(index) if index is not None else 0,
                        "column": self.column,
                        "value": cell_value_str,
                        "message": f"字符集约束冲突: 值 '{cell_value_str}' 包含非{charset_name}字符。",
                    }
                )

        return {"errors": errors, "info": self.get_constraint_info()}

    def _check_charset(self, value: str, mode: str) -> bool:
        """
        检查字符串是否符合指定字符集

        参数:
            value: 要检查的字符串
            mode: 字符集模式，"ascii"、"chinese" 或 "chinese_mixed"

        返回:
            True 表示符合指定字符集，False 表示不符合
        """
        if mode == "ascii":
            return self._is_ascii(value)
        elif mode == "chinese":
            return self._is_chinese(value)
        elif mode == "chinese_mixed":
            return self._is_chinese_mixed(value)
        return True

    def _is_ascii(self, value: str) -> bool:
        """
        检查字符串是否为纯 ASCII 字符

        原理: 尝试用 ASCII 编码对字符串进行编码，如果成功则说明是纯 ASCII。
        如果包含非 ASCII 字符（如中文），则会抛出 UnicodeEncodeError。

        参数:
            value: 要检查的字符串

        返回:
            True 表示纯 ASCII，False 表示包含非 ASCII 字符
        """
        try:
            value.encode("ascii")
            return True
        except UnicodeEncodeError:
            return False

    def _is_chinese_char(self, char: str) -> bool:
        """判断单个字符是否属于中文相关 Unicode 区块（CJK 及中文标点）。"""
        if "\u4e00" <= char <= "\u9fff":
            return True
        if "\u3400" <= char <= "\u4dbf":
            return True
        if "\U00020000" <= char <= "\U0002a6df":
            return True
        if "\U0002a700" <= char <= "\U0002b73f":
            return True
        if "\U0002b740" <= char <= "\U0002b81f":
            return True
        if "\U0002b820" <= char <= "\U0002ceaf":
            return True
        if "\u3000" <= char <= "\u303f":
            return True
        if "\uff00" <= char <= "\uffef":
            return True
        return False

    def _is_chinese(self, value: str) -> bool:
        """
        检查字符串是否为纯中文字符

        原理: 遍历字符串中的每个字符，检查其 Unicode 码点是否落在
        中日韩统一表意文字（CJK）及其扩展区、以及中文标点符号的范围内。

        支持的 Unicode 区块:
            - \u4e00-\u9fff: 基本汉字
            - \u3400-\u4dbf: 扩展A区
            - \U00020000-\U0002a6df: 扩展B区
            - \U0002a700-\U0002b73f: 扩展C区
            - \U0002b740-\U0002b81f: 扩展D区
            - \U0002b820-\U0002ceaf: 扩展E区
            - \u3000-\u303f: 中文标点符号（CJK Symbols and Punctuation）
            - \uff00-\uffef: 全角字符（Halfwidth and Fullwidth Forms）

        参数:
            value: 要检查的字符串

        返回:
            True 表示所有字符都在中文相关 Unicode 区块内，False 表示包含其他字符
        """
        for char in value:
            if not self._is_chinese_char(char):
                return False
        return len(value) > 0

    def _is_chinese_mixed(self, value: str) -> bool:
        """
        检查字符串是否为中文混合字符

        允许 CJK 中文相关字符，以及 ASCII 字母、数字和常见标点符号。

        参数:
            value: 要检查的字符串

        返回:
            True 表示符合中文混合字符集，False 表示包含其他字符
        """
        for char in value:
            if self._is_chinese_char(char):
                continue
            if char.isascii() and (char.isalnum() or char in self._CHINESE_MIXED_PUNCTUATION):
                continue
            return False
        return len(value) > 0
