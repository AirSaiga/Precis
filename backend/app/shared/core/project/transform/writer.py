"""@fileoverview Transform 节点写入模块

功能概述:
- 写入 *.transform.yaml 文件
- 优化字段顺序，提升 YAML 可读性

架构设计:
- 唯一入口: 封装 Pydantic 模型到 YAML 文件的转换逻辑
- 字段排序: 按重要程度分组（核心 / 可选 / 内部）
- 一致性: 与 schema/writer.py、regex/writer.py 保持一致的排序策略

输入示例:
    transform = TransformFile(
        version=2,
        id="cast_price",
        type="CastType",
        input_column="price",
        params={"target_type": "decimal"},
        output_columns=["price"],
    )

输出示例:
    save_transform(transform, "transforms/cast_price.transform.yaml")
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from app.shared.core.io.yaml import write_yaml

from .types import TransformFile

if TYPE_CHECKING:
    from .types import TransformFile


def save_transform(transform: TransformFile, transform_path: str | Path) -> None:
    """
    @methoddesc 保存 Transform 节点到 YAML 文件。

    字段顺序优化（按重要程度分组）：
    L1（核心）：type, description, params, input_from_node, input_column
    L2（可选）：enabled, output_columns
    L3（内部）：version, id

    :param transform: TransformFile 对象，包含转换节点的完整配置
    :param transform_path: 保存路径，可以是相对路径或绝对路径
    :raises IOError: 文件写入失败时抛出
    """
    data = transform.model_dump()

    ordered = {
        # L1 - 核心字段
        "type": data["type"],
        "description": data.get("description"),
        "input_from_node": data.get("input_from_node"),
        "input_column": data.get("input_column"),
        "params": data.get("params", {}),
        # L2 - 可选配置
        "enabled": data.get("enabled", True),
        "output_columns": data.get("output_columns", []),
        # L3 - 内部字段
        "version": data["version"],
        "id": data["id"],
    }

    write_yaml(Path(transform_path), ordered)
