"""
@fileoverview 约束文件删除模块

功能概述:
- 根据约束类型、表名和列名生成约束 ID
- 删除对应的 .constraint.yaml 文件
- 使用文件锁保护删除操作

输入示例:
    success, message = delete_constraint_file("NotNull", "users", "email", "/workspace")

输出示例:
    (True, "notnull_users_email")
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.shared.services.llm.constraints.constraint_id import _generate_constraint_id
from app.shared.services.llm.yaml_io import FileLock

logger = logging.getLogger(__name__)


def delete_constraint_file(
    constraint_type: str, table_name: str, column_name: str, workspace_path: str
) -> tuple[bool, str]:
    """
    @methoddesc 删除独立约束文件

    根据约束类型、表名和列名生成约束 ID，然后删除对应的 .constraint.yaml 文件。
    使用文件锁保护删除操作，防止并发冲突。

    参数:
        constraint_type: 约束类型
        table_name: 表名
        column_name: 列名
        workspace_path: 工作区路径

    返回:
        元组 (是否成功, 约束ID 或错误信息)

    示例:
        >>> success, msg = delete_constraint_file("NotNull", "users", "email", "/workspace")
        >>> success
        True
    """
    try:
        # 根据类型、表、列生成预期的约束文件 ID
        constraint_id = _generate_constraint_id(constraint_type, table_name, column_name)
        constraint_file_path = Path(workspace_path) / "constraints" / f"{constraint_id}.constraint.yaml"

        # 使用文件锁保护删除操作，防止并发冲突
        with FileLock(str(constraint_file_path)):
            if constraint_file_path.exists():
                constraint_file_path.unlink()
                logger.info(f"[updateYamlConfig] 成功删除约束文件: {constraint_file_path}")
                return True, constraint_id
            else:
                error_msg = f"约束文件不存在: {constraint_file_path}"
                logger.warning(f"[updateYamlConfig] {error_msg}")
                return False, error_msg

    except Exception as e:
        error_msg = f"删除约束文件失败: {str(e)}"
        logger.error(f"[updateYamlConfig] {error_msg}")
        return False, error_msg
