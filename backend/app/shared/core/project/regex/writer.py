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
    2. 按重要程度重新组织字段顺序
    3. 写入 YAML 文件

    :param regex_node: RegexNodeFile 对象，包含正则节点的完整配置
    :param regex_path: 保存路径，可以是相对路径或绝对路径
    :raises IOError: 文件写入失败时抛出
    """
    # 步骤1：将 Pydantic 模型序列化为字典
    # model_dump() 会包含所有字段，包括默认值
    data = regex_node.model_dump()

    # 步骤2：按重要程度重新组织字段顺序
    # 核心字段放在前面，提升 YAML 可读性
    ordered = {
        # L1 - 核心字段（用户最常编辑）
        "name": data["name"],  # 节点名称，核心标识
        "description": data.get("description"),  # 节点描述
        "pattern": data.get("pattern"),  # 直接模式的正则表达式
        "uses_pattern": data.get("uses_pattern"),  # 引用模式的模式引用
        "pattern_overrides": data.get("pattern_overrides"),  # 引用模式的覆盖配置
        # L2 - 可选配置（功能开关和模式）
        "enabled": data.get("enabled", True),  # 是否启用该节点
        "match_mode": data.get("match_mode", "full"),  # 匹配模式
        # L3 - 内部字段（开发者/系统使用）
        "version": data["version"],  # 配置版本号
        "id": data["id"],  # 节点唯一标识
        "_internal": data.get("_internal", {}),  # 内部元数据
    }

    # 步骤3：调用底层 YAML 写入工具
    write_yaml(Path(regex_path), ordered)
