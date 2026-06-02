"""
@fileoverview 正则表达式约束模块

功能概述:
- 实现 RegexConstraint 类
- 验证指定列的数据是否符合正则表达式模式
- 支持全匹配(full)和搜索(search)两种匹配模式
- 支持正则表达式标志配置(i/m/s)和大小写控制

架构设计:
- 继承基类: 继承自 Constraint 抽象类
- 预编译优化: 预先编译正则表达式为 Pattern 对象
- 防御式编程: 捕获 re.error 和类型转换错误

输入示例:
    constraint = RegexConstraint(
        table="users",
        column="email",
        pattern=r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
        match_mode="full",
        flags="i",
    )

    datasets = {
        "users": DataFrame({
            "email": ["test@example.com", "invalid-email", None]
        })
    }

输出示例:
    {
        "errors": [
            {
                "row_index": 1,
                "column": "email",
                "value": "invalid-email",
                "message": "值 'invalid-email' 不符合正则表达式模式"
            }
        ],
        "info": {...}
    }
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from app.shared.domain.constraints.base import Constraint


class RegexConstraint(Constraint):
    """
    @classdesc 正则表达式约束

    验证指定列的数据是否符合正则表达式模式。
    空值(NaN/None)跳过校验，不计入错误。

    参数:
        table: 表名
        column: 列名
        pattern: 正则表达式模式字符串
        match_mode: 匹配模式，"full" 全匹配或 "search" 搜索匹配
        flags: 正则表达式标志字符串（如 "i" 不区分大小写）
        case_sensitive: 是否区分大小写
    """

    def __init__(
        self,
        table: str = "temp",
        column: str = "",
        pattern: str = "",
        match_mode: str = "full",
        flags: str = "",
        case_sensitive: bool = True,
    ):
        self.table = table
        self.column = column
        self.pattern = pattern
        self.match_mode = match_mode
        self.flags = flags
        self.case_sensitive = case_sensitive

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        """执行正则表达式约束验证。"""
        errors: list[dict[str, Any]] = []

        df = datasets.get(self.table)
        if df is None:
            return {"valid": True, "errors": errors, "info": self.get_constraint_info()}

        if self.column not in df.columns:
            return {"valid": True, "errors": errors, "info": self.get_constraint_info()}

        if not self.pattern:
            return {"valid": True, "errors": errors, "info": self.get_constraint_info()}

        try:
            # 解析正则表达式标志
            re_flags = 0
            flags_set = set(self.flags.lower())
            if "i" in flags_set:
                re_flags |= re.IGNORECASE
            if "m" in flags_set:
                re_flags |= re.MULTILINE
            if "s" in flags_set:
                re_flags |= re.DOTALL
            if not self.case_sensitive:
                re_flags |= re.IGNORECASE

            regex = re.compile(self.pattern, re_flags)

            for row_index, cell_value in df[self.column].items():
                if pd.isna(cell_value) or cell_value is None:
                    continue

                cell_value_str = str(cell_value)

                try:
                    if self.match_mode == "full":
                        match_result = regex.fullmatch(cell_value_str)
                    else:
                        match_result = regex.search(cell_value_str)

                    if not match_result:
                        errors.append(
                            {
                                "row_index": row_index,
                                "column": self.column,
                                "value": cell_value_str,
                                "message": f"值 '{cell_value_str}' 不符合正则表达式模式",
                            }
                        )
                except (TypeError, ValueError) as e:
                    errors.append(
                        {
                            "row_index": row_index,
                            "column": self.column,
                            "value": cell_value_str,
                            "message": f"校验出错: {cell_value_str} ({type(e).__name__}: {e})",
                        }
                    )

        except re.error as e:
            errors.append(
                {
                    "row_index": 0,
                    "column": self.column,
                    "value": None,
                    "message": f"正则表达式语法错误: {e}",
                }
            )

        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "info": self.get_constraint_info(),
        }

    def _get_description(self) -> str:
        return f"正则约束: {self.table}.{self.column} pattern={self.pattern!r}"
