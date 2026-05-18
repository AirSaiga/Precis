"""
@fileoverview 项目文件扫描模块

功能概述:
- 扫描 constraints 目录查找指定 ID 的 constraint 引用
- 扫描 schemas 目录查找指定 ID 的 schema 引用
- 扫描 patterns 和 regex 目录查找指定 ID 的 regex_node 引用

架构设计:
- 纯 Python 实现，不依赖 FastAPI，便于单元测试
- 两层查找策略：先检查目录存在性，再遍历匹配文件名
- 兼容 manifest 资源列表为空或目录不存在的边界情况
- 文件名匹配时自动提取 ID（去掉扩展名后缀）

输入示例:
    ref = _scan_schema_file("users", "/project/root")

输出示例:
    SchemaRefV2(id="users", path="schemas/users.schema.yaml")
"""

import os
from typing import Optional

from app.shared.core.project.manifest.types import (
    ConstraintRefV2,
    RegexNodeRefV2,
    SchemaRefV2,
)


def _scan_constraint_file(constraint_id: str, config_path: str) -> Optional[ConstraintRefV2]:
    """
    扫描 constraints 目录查找指定 ID 的 constraint 引用。

    扫描逻辑（两层查找，更健壮）：
    1. 检查 constraints/ 目录是否存在
    2. 遍历目录下所有 .constraint.yaml 文件（大小写不敏感）
    3. 从文件名中提取 constraint_id（去掉 .constraint.yaml 后缀）
    4. 如果找到匹配则返回 ConstraintRefV2 对象

    兼容的边界情况：
    - manifest.constraints 为空的情况（部分项目可能未更新 manifest）
    - 文件名大小写不敏感的匹配
    - constraints 目录不存在的情况

    参数:
        constraint_id: 要查找的 constraint ID
        config_path: 项目配置根目录

    返回:
        找到的 ConstraintRefV2 对象，未找到返回 None
    """
    constraints_dir = os.path.join(config_path, "constraints")
    if not os.path.isdir(constraints_dir):
        return None

    for filename in os.listdir(constraints_dir):
        if filename.lower().endswith(".constraint.yaml"):
            scanned_id = filename[:-16]
            if scanned_id == constraint_id:
                return ConstraintRefV2(id=constraint_id, path=f"constraints/{filename}")
    return None


def _scan_schema_file(table_id: str, config_path: str) -> Optional[SchemaRefV2]:
    """
    扫描 schemas 目录查找指定 ID 的 schema 引用。

    扫描逻辑：
    1. 检查 schemas/ 目录是否存在
    2. 遍历目录下所有 .schema.yaml 文件
    3. 从文件名中提取 table_id（去掉 .schema.yaml 后缀）
    4. 如果找到匹配则返回 SchemaRefV2 对象

    兼容的边界情况：
    - manifest.schemas 为空的情况
    - schemas 目录不存在的情况

    参数:
        table_id: 要查找的 schema table ID
        config_path: 项目配置根目录

    返回:
        找到的 SchemaRefV2 对象，未找到返回 None
    """
    schemas_dir = os.path.join(config_path, "schemas")
    if not os.path.isdir(schemas_dir):
        return None

    for filename in os.listdir(schemas_dir):
        if filename.endswith(".schema.yaml"):
            scanned_id = filename[:-12]
            if scanned_id == table_id:
                return SchemaRefV2(id=table_id, path=f"schemas/{filename}")
    return None


def _scan_regex_node_file(
    regex_id: str,
    config_path: str,
    patterns_dir: str = "patterns",
    regex_dir: str = "regex",
) -> Optional[RegexNodeRefV2]:
    """
    扫描 patterns 和 regex 目录查找指定 ID 的 regex_node 引用。

    扫描逻辑：
    1. 依次检查 regex_dir 和 patterns_dir 目录
    2. 遍历目录下的 .yaml 文件
    3. 从文件名中提取 regex_id（去掉扩展名后缀）
    4. 如果找到匹配则返回 RegexNodeRefV2 对象

    兼容的边界情况：
    - manifest.regex_nodes 为空的情况
    - patterns_dir 目录不存在的情况
    - regex_node 可能位于任一目录中

    参数:
        regex_id: 要查找的 regex node ID
        config_path: 项目配置根目录
        patterns_dir: patterns 目录名（默认 "patterns"）
        regex_dir: regex 目录名（默认 "regex"）

    返回:
        找到的 RegexNodeRefV2 对象，未找到返回 None
    """
    regex_dir_path = os.path.join(config_path, regex_dir)
    if os.path.isdir(regex_dir_path):
        for filename in os.listdir(regex_dir_path):
            if filename.endswith(".regex.yaml"):
                scanned_id = filename[:-11]
                if scanned_id == regex_id:
                    return RegexNodeRefV2(id=regex_id, path=f"{regex_dir}/{filename}")

    dir_path = os.path.join(config_path, patterns_dir)
    if os.path.isdir(dir_path):
        for filename in os.listdir(dir_path):
            if filename.endswith(".yaml"):
                scanned_id = filename[:-5]
                if scanned_id == regex_id:
                    return RegexNodeRefV2(id=regex_id, path=f"{patterns_dir}/{filename}")
    return None
