"""
@fileoverview 约束抽象基类模块

功能概述:
- 定义所有约束类型的抽象基类 (Constraint)
- 提供统一的约束接口和方法

架构设计:
- 抽象基类: 定义 validate() 抽象方法
- 子类实现: 每个具体约束类型实现自己的验证逻辑
- 信息获取: 提供 get_constraint_info() 获取约束元信息

输入示例:
    # datasets 输入 (多个 DataFrame 的字典)
    datasets = {
        "users": DataFrame({
            "id": [1, 2, 3],
            "username": ["alice", "bob", None],
            "email": ["alice@test.com", "bob@test.com", "charlie@test.com"]
        }),
        "orders": DataFrame({
            "id": [1, 2, 3],
            "user_id": [1, 2, 1]
        })
    }

输出示例:
    # validate() 返回结果
    {
        "valid": True,
        "errors": []
    }

    # 或验证失败
    {
        "valid": False,
        "errors": [
            {"row": 2, "column": "username", "message": "列 'username' 不能为空"}
        ]
    }

    # get_constraint_info() 返回结果
    {
        "constraint_type": "NotNullConstraint",
        "table": "users",
        "description": "NotNull 约束"
    }
"""

from __future__ import annotations

# 1. 标准库导入
from abc import ABC, abstractmethod
from typing import Any

# 2. 第三方库导入
import pandas as pd


class Constraint(ABC):
    """
    @classdesc 约束抽象基类

    所有约束类的基类，定义统一的约束接口。
    子类必须实现 validate() 方法，用于执行具体的验证逻辑。
    """

    @abstractmethod
    def validate(self, datasets: dict[str, pd.DataFrame], **kwargs) -> dict[str, Any]:
        """
        @methoddesc 执行约束验证

        抽象方法，子类必须实现具体的验证逻辑。

        参数:
            datasets: 数据集字典，键为表名，值为对应的 pandas DataFrame
            **kwargs: 额外的关键字参数，供子类按需使用

        返回:
            验证结果字典，通常包含:
                - errors: 错误列表，每个元素是一个描述错误的字典
                - info: 约束的基本信息（通过 get_constraint_info() 获取）

        注意:
            子类必须重写此方法，否则无法实例化。
        """

        pass

    def get_constraint_info(self) -> dict[str, Any]:
        """
        @methoddesc 获取约束的基本信息

        返回约束的类型、作用表和描述等元信息，用于日志记录和错误报告。

        返回:
            包含以下字段的字典:
                - constraint_type: 约束类名
                - table: 约束作用的表名（优先取 self.table，否则取 self.from_table）
                - description: 约束的描述信息
        """

        return {
            "constraint_type": self.__class__.__name__,
            "table": getattr(self, "table", getattr(self, "from_table", None)),
            "description": self._get_description(),
        }

    def _get_description(self) -> str:
        """
        @methoddesc 获取约束的描述信息

        默认实现返回 "{类名} 约束"，子类可重写以提供更具体的描述。

        返回:
            约束的描述字符串
        """

        return f"{self.__class__.__name__} 约束"
