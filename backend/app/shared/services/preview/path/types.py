"""@fileoverview 路径处理服务数据类型定义模块

功能概述:
- 定义路径权限策略枚举（PathPolicy）
- 定义白名单条目数据类（WhitelistEntry）
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class PathPolicy(str, Enum):
    """
    @classdesc 路径权限策略枚举

    定义了三种访问控制级别，用于白名单配置中的权限字段：
    - READONLY: 任何用户均可访问（最低限制）
    - ADMIN: 仅管理员角色可访问
    - OWNER: 仅指定的所有者用户可访问（最高限制）
    """

    READONLY = "readonly"  # 只读：所有用户均可访问
    ADMIN = "admin"  # 管理员：仅管理员角色可访问
    OWNER = "owner"  # 所有者：仅特定用户可访问


@dataclass
class WhitelistEntry:
    """
    @classdesc 白名单条目数据类

    表示一条白名单规则，包含路径、权限策略、所有者及描述信息。

    字段:
        path: 允许访问的文件或目录路径（建议使用绝对路径）
        policy: 该路径的访问权限策略，默认为只读
        owner_id: 当策略为 OWNER 时，指定拥有者的用户标识
        description: 该条目的说明文字（可选，便于人工阅读配置）

    使用示例:
        entry = WhitelistEntry(
            path="/data/projects",
            policy=PathPolicy.ADMIN,
            description="项目数据目录，仅限管理员访问"
        )
    """

    path: str  # 允许访问的路径
    policy: PathPolicy = PathPolicy.READONLY  # 默认权限为只读
    owner_id: Optional[str] = None  # 所有者用户ID（OWNER策略时使用）
    description: Optional[str] = None  # 条目描述（可选）
