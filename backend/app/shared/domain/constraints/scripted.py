"""
@fileoverview 脚本化约束模块

功能概述:
- 实现 ScriptedConstraint 类
- 通过 Python 表达式定义自定义验证逻辑
- 允许执行复杂的业务规则验证

架构设计:
- 继承基类: 继承自 Constraint 抽象类
- 安全控制: 需要显式开启 allow_unsafe_eval 才能执行
- 表达式验证: 使用 simpleeval 库执行表达式，提供沙箱环境

输入示例:
    # 约束配置 - 验证手机号格式
    constraint1 = ScriptedConstraint(
        table="users",
        name="valid_phone",
        expression="re_match(r'^1[3-9]\\d{9}$', str(value))",
        column="phone"
    )

    # 约束配置 - 验证复杂业务规则
    constraint2 = ScriptedConstraint(
        table="orders",
        name="valid_discount",
        expression="value <= row['total_amount'] * 0.5",
        column="discount"
    )

输出示例:
    # 验证失败
    {
        "errors": [
            {
                "error_type": "ScriptedConstraintViolation",
                "table": "users",
                "row_index": 0,
                "column": "phone",
                "value": "12345",
                "message": "脚本约束冲突: 表达式 're_match(r'^1[3-9]\\d{9}$', str(value))' 验证失败。"
            }
        ],
        "info": {...}
    }

原理说明:
    表达式上下文:
    - value: 当前单元格的值
    - row: 当前行的数据 (字典形式)
    - re_match: 正则匹配函数，接收 pattern 和 string，返回是否匹配
    - len, sum, max, min 等基础函数

    安全警告:
    - 默认禁用脚本约束，需要设置 allow_unsafe_eval=True
    - simpleeval 提供了比原生 eval() 更严格的沙箱环境
    - 仍需谨慎使用，避免执行恶意代码
"""

from __future__ import annotations

# 1. 标准库导入
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# 2. 第三方库导入
import numpy as np
import pandas as pd
from simpleeval import SimpleEval

# 3. 项目内部导入
from app.shared.domain.constraints.base import Constraint


class ScriptedConstraint(Constraint):
    """
    @classdesc 脚本化约束

    通过 Python 表达式定义自定义验证逻辑。
    每行数据独立执行表达式，表达式返回 True 表示通过，False 表示失败。
    """

    def __init__(self, table: str, name: str, expression: str, column: str | None = None):
        """
        @methoddesc 初始化脚本化约束

        参数:
            table: 目标表名
            name: 约束规则名称，用于错误消息中标识
            expression: Python 表达式字符串，在每一行上执行
            column: 目标列名，可选。如果指定，该列的值会作为 value 变量传入表达式
        """
        self.table = table
        self.name = name
        self.expression = expression
        self.column = column

    def _get_description(self) -> str:
        """生成脚本约束描述"""
        return f"脚本约束: {self.table}.{self.name}"

    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        """
        @methoddesc 执行脚本化验证

        参数:
            datasets: 数据集字典，键为表名，值为 pandas DataFrame
            **kwargs: 额外的关键字参数，必须包含 allow_unsafe_eval=True 才能执行

        返回:
            验证结果字典，包含 errors（错误列表）和 info（约束信息）

        逻辑说明:
            1. 检查 allow_unsafe_eval 是否开启，未开启则跳过
            2. 检查目标表是否存在
            3. 配置 simpleeval 沙箱环境，注册安全的基础函数
            4. 遍历每一行数据，构建表达式执行上下文
            5. 执行表达式并检查结果
            6. 如果结果不是布尔值，记录定义错误
            7. 如果结果为 False，记录业务逻辑违规
            8. 如果表达式执行抛出异常，记录执行错误
        """
        errors = []

        # 安全检查: 必须显式开启 allow_unsafe_eval 才能执行脚本约束
        if not kwargs.get("allow_unsafe_eval", False):
            errors.append(
                {
                    "error_type": "PermissionError",
                    "table": self.table,
                    "message": f"脚本化约束 '{self.name}' 因 'allow_unsafe_eval' 未开启而被跳过。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        # 检查目标表是否存在
        if self.table not in datasets:
            errors.append(
                {
                    "error_type": "ConstraintConfigError",
                    "table": self.table,
                    "column": self.column,
                    "message": f"脚本约束失败: 表 '{self.table}' 不在数据集中。",
                }
            )
            return {"errors": errors, "info": self.get_constraint_info()}

        df = datasets[self.table]

        # ============================================================================
        # 配置 simpleeval 沙箱环境
        # ============================================================================
        # 只允许使用以下安全的基础函数，避免执行危险操作
        base_functions = {
            "len": len,
            "sum": sum,
            "max": max,
            "min": min,
            "round": round,
            "abs": abs,
            "any": any,
            "all": all,
            "int": int,
            "str": str,
            "float": float,
            "bool": bool,
            "list": list,
            "dict": dict,
            "set": set,
        }

        # 遍历每一行数据执行表达式
        for index, row_dict in df.to_dict("index").items():
            row_index = int(index) if index is not None else 0

            # 获取当前单元格的值（如果指定了 column）
            cell_value = row_dict.get(self.column) if self.column else None

            # 创建 simpleeval 求值器，注入 row 和 value 变量
            evaluator = SimpleEval(names={"row": row_dict, "value": cell_value})
            # 注册基础函数
            evaluator.functions.update(base_functions)
            # 注册正则匹配函数 re_match(pattern, string)
            evaluator.functions["re_match"] = lambda p, s: re.match(p, s) is not None

            try:
                # 执行表达式
                result = evaluator.eval(self.expression)

                # 检查结果类型: 必须是布尔值
                if not isinstance(result, (bool, np.bool_)):
                    errors.append(
                        {
                            "error_type": "ScriptCheckDefinitionError",
                            "table": self.table,
                            "row_index": int(row_index),
                            "message": f"规则 '{self.name}' 的表达式没有返回布尔值(True/False),而是返回了 {type(result).__name__}。",
                        }
                    )
                    continue

                # 结果为 False 表示验证失败
                if result is False:
                    errors.append(
                        {
                            "error_type": "BusinessLogicViolation",
                            "table": self.table,
                            "row_index": int(row_index),
                            "value": f"整行数据: {row_dict}",
                            "message": f"业务逻辑检查失败: '{self.name}'",
                        }
                    )
            except Exception as e:
                # 表达式执行过程中抛出异常
                # 记录详细异常信息到日志，但向用户返回脱敏后的通用错误消息
                logger.warning(
                    f"脚本约束执行错误: 规则='{self.name}', 表='{self.table}', "
                    f"行={row_index}, 表达式='{self.expression}', 错误={e}",
                    exc_info=True,
                )
                errors.append(
                    {
                        "error_type": "ScriptCheckExecutionError",
                        "table": self.table,
                        "row_index": int(row_index),
                        "message": f"执行规则 '{self.name}' 时发生错误，请检查表达式语法或数据类型。",
                        "expression": self.expression,
                    }
                )

        return {"errors": errors, "info": self.get_constraint_info()}
