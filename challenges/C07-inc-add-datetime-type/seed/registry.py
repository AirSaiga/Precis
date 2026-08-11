"""数据类型注册表（C07 seed）。

新增数据类型需在此注册。build_type_from_config 是校验入口——
未知类型会抛 ValueError。"""

from __future__ import annotations

from data_types import DataType, DateType, IntegerType

# 类型注册表：类型名 → 工厂（返回 DataType 实例）
TYPE_REGISTRY: dict[str, type[DataType]] = {
    "integer": IntegerType,
    "date": DateType,
}


def build_type_from_config(type_name: str) -> DataType:
    """根据类型名构建 DataType 实例。

    未知类型抛 ValueError。
    """
    type_cls = TYPE_REGISTRY.get(type_name)
    if type_cls is None:
        raise ValueError(f"未知数据类型: {type_name}")
    return type_cls()
