"""
@fileoverview 正则节点写入模块

功能概述:
- 写入 *.regex.yaml 文件
- 优化字段顺序，提升 YAML 可读性

架构设计:
- 唯一入口: 封装 Pydantic 模型到 YAML 文件的转换逻辑
- 字段排序: 按重要程度分组（核心 / 可选 / 内部）
- 一致性: 与 schema/writer.py 保持一致的排序策略

输入示例:
    node = RegexNodeFile(
        version=2,
        id="email",
        name="邮箱校验",
        pattern="^[\\w\\.-]+@[\\w\\.-]+\\.\\w+$",
        match_mode="full",
        enabled=True,
    )

输出示例:
    save_regex_node(node, "regex/email.regex.yaml")
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from app.shared.core.io.yaml import write_yaml

from .types import RegexNodeFile

if TYPE_CHECKING:
    from .types import RegexNodeFile


def save_regex_node(regex_node: RegexNodeFile, regex_path: str | Path) -> None:
    """
    @methoddesc 保存正则节点到 YAML 文件。

    字段顺序优化（按重要程度分组）：
    L1（核心）：name, description, pattern/uses_pattern
    L2（可选）：enabled, match_mode
    L3（内部）：version, id, _internal

    处理流程：
    1. 将 RegexNodeFile 对象序列化为字典（model_dump）
    2. 按重要程度重新组织字段顺序（其余字段追加在末尾，确保不丢失）
    3. 写入 YAML 文件

    设计说明：
    历史版本曾用手动白名单挑字段，导致新增字段（如 source_ref、input_from_node、
    rules 等）被静默丢弃。现改为「全量保留 + 顺序优化」：先 dump 全部字段，
    再按指定顺序重排，未在顺序表中的字段自动追加到末尾，从根本上避免丢字段。

    :param regex_node: RegexNodeFile 对象，包含正则节点的完整配置
    :param regex_path: 保存路径，可以是相对路径或绝对路径
    :raises IOError: 文件写入失败时抛出
    """
    # 步骤1：将 Pydantic 模型序列化为字典（包含全部字段）
    data = regex_node.model_dump()

    # 步骤2：按重要程度重排字段顺序
    # 核心字段在前，其余字段追加其后，保证不丢失任何字段
    ordered_keys = [
        # L1 - 核心字段（用户最常编辑）
        "name",
        "description",
        "pattern",
        "uses_pattern",
        "pattern_overrides",
        # L2 - 可选配置（功能开关和模式）
        "enabled",
        "match_mode",
        "case_sensitive",
        "flags",
        # 数据流与上游绑定（重建画布连线必需）
        "source_ref",
        "source_column_name",
        "input_from_node",
        "input_column",
        # Extract 模式专用
        "capture_groups",
        "output_columns",
        # 前端扩展结构
        "parameters",
        "rules",
        # L3 - 内部字段（开发者/系统使用）
        "version",
        "id",
        "_internal",
    ]

    ordered: dict[str, object] = {}
    # 先按指定顺序写入已知字段
    for key in ordered_keys:
        if key in data:
            ordered[key] = data[key]
    # 再追加未在顺序表中的字段（未来新增字段自动保留，防止再次丢字段）
    for key, value in data.items():
        if key not in ordered:
            ordered[key] = value

    # 步骤3：调用底层 YAML 写入工具
    write_yaml(Path(regex_path), ordered)
