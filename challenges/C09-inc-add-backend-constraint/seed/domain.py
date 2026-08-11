"""领域层：约束类型定义（C09 seed）。

后端三层分离：domain（纯业务逻辑）/ services（编排）/ api（路由）。
本文件是 domain 层，定义约束基类和现有约束。
"""

from __future__ import annotations

from typing import Any


class Constraint:
    """约束基类。"""

    constraint_type: str = "base"

    def validate(self, value: Any) -> bool:
        """校验单个值，合法返回 True。"""
        raise NotImplementedError


class RegexConstraint(Constraint):
    """正则约束：值必须匹配给定模式。"""

    constraint_type = "regex"

    def __init__(self, pattern: str):
        import re

        self._pattern = re.compile(pattern)

    def validate(self, value: Any) -> bool:
        if not isinstance(value, str):
            return False
        return bool(self._pattern.match(value))


# 约束注册表：约束类型名 → 工厂函数
CONSTRAINT_FACTORIES: dict[str, type[Constraint]] = {
    "regex": RegexConstraint,
}


def build_constraint(type_name: str, params: dict[str, Any]) -> Constraint | None:
    """根据类型名和参数构建约束实例。未知类型返回 None。"""
    cls = CONSTRAINT_FACTORIES.get(type_name)
    if cls is None:
        return None
    return cls(**params)
