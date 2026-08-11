"""数据类型定义（C07 seed）。

包含 DateType 和 IntegerType 两种已有类型作为参考。
任务：新增 DateTimeType，遵循 DateType 的模式。"""

from __future__ import annotations

import re
from datetime import datetime


class DataType:
    """数据类型基类。"""

    name: str = "base"

    def validate(self, value: object) -> bool:
        """校验值是否合法。"""
        raise NotImplementedError

    def parse(self, value: object) -> object:
        """解析值为 Python 类型。"""
        raise NotImplementedError


class IntegerType(DataType):
    """整数类型。"""

    name = "integer"

    def validate(self, value: object) -> bool:
        try:
            int(value)
            return True
        except (ValueError, TypeError):
            return False

    def parse(self, value: object) -> object:
        return int(value)


class DateType(DataType):
    """日期类型（YYYY-MM-DD）。"""

    name = "date"
    _PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

    def validate(self, value: object) -> bool:
        if not isinstance(value, str):
            return False
        if not self._PATTERN.match(value):
            return False
        try:
            datetime.strptime(value, "%Y-%m-%d")
            return True
        except ValueError:
            return False

    def parse(self, value: object) -> object:
        return datetime.strptime(value, "%Y-%m-%d").date()
