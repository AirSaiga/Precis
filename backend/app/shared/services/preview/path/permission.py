"""@fileoverview 路径权限检查模块

功能概述:
- 检查用户对指定路径的访问权限（团队版功能）
- 支持只读、管理员、所有者三种权限策略
"""

import os
from typing import Optional

from app.shared.core.edition import is_team_edition
from app.shared.services.preview.path.whitelist import (
    load_whitelist_config,
)


def check_path_permission(file_path: str, user_role: str = "member", user_id: Optional[str] = None) -> tuple[bool, str]:
    """
    @methoddesc 检查用户对路径的权限（团队版功能）

    根据个人版/团队版、白名单配置版本以及用户角色，综合判断访问权限。
    权限策略优先级：只读(readonly) < 管理员(admin) < 所有者(owner)。

    参数:
        file_path: 要检查的文件路径（绝对或相对路径）
        user_role: 用户角色，可选值为 "admin"（管理员）或 "member"（普通成员）
        user_id: 用户唯一标识（当路径策略为 owner 时用于匹配所有权）

    返回:
        元组 (has_permission, reason)
        - has_permission: True 表示允许访问，False 表示拒绝
        - reason: 权限判断的具体原因说明

    权限逻辑：
        - 个人版：不检查权限，默认允许
        - v1.0 配置：不检查权限，默认允许
        - v2.0 配置：按路径匹配的策略逐级判断
    """
    # 个人版直接放行，不启用权限检查
    if not is_team_edition():
        return True, "个人版不检查权限"

    config = load_whitelist_config()
    version = config.get("version", "1.0")

    # 只有 v2.0 配置才支持细粒度权限控制
    if version != "2.0":
        return True, "v1.0配置不检查权限"

    # 文件尚不存在时默认允许访问（用于新建场景）
    if not os.path.exists(file_path):
        return True, "文件不存在，默认允许"

    # 解析真实路径以处理符号链接，确保权限基于最终目标路径
    resolved_path = os.path.realpath(file_path)
    default_policy = config.get("default_policy", "readonly")
    paths_config = config.get("paths", [])

    # 遍历白名单配置，按路径前缀匹配查找适用的策略
    for entry in paths_config:
        if isinstance(entry, dict):
            entry_path = os.path.normpath(entry.get("path", ""))
        else:
            continue

        try:
            # 将配置中的路径也解析为真实路径，避免符号链接绕过
            entry_resolved = os.path.realpath(entry_path)
            # 使用前缀匹配：目标路径以白名单路径开头，或是白名单路径本身
            if resolved_path.startswith(entry_resolved + os.sep) or resolved_path == entry_resolved:
                policy = entry.get("policy", default_policy)

                # 只读策略：所有用户均可访问
                if policy == "readonly":
                    return True, "只读路径"

                # 管理员策略：仅当 user_role 为 admin 时允许
                if policy == "admin":
                    if user_role == "admin":
                        return True, "管理员权限"
                    return False, "需要管理员权限"

                # 所有者策略：仅当 user_id 与配置的 owner_id 匹配时允许
                if policy == "owner":
                    owner_id = entry.get("owner_id")
                    if owner_id and user_id and owner_id == user_id:
                        return True, "所有者权限"
                    return False, "需要路径所有权"

        # 忽略单条配置解析异常，继续检查其他条目
        except Exception:
            continue

    # 未匹配到任何白名单条目时，使用默认策略
    if default_policy == "readonly":
        return True, "默认只读策略"

    return False, "无权限访问"


def is_path_writable(file_path: str, user_role: str = "member", user_id: Optional[str] = None) -> bool:
    """
    @methoddesc 判断路径是否可写

    该函数是 check_path_permission 的便捷包装，只返回布尔结果而不返回原因。
    在需要简单判断"能不能写"的场景下使用。

    参数:
        file_path: 要检查的文件路径
        user_role: 用户角色（admin / member）
        user_id: 用户唯一标识

    返回:
        True 表示路径可写，False 表示不可写或无权限
    """
    has_permission, _ = check_path_permission(file_path, user_role, user_id)
    return has_permission
