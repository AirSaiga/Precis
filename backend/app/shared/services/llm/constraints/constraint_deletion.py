# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
@fileoverview 约束文件删除模块

功能概述:
- 优先按显式 constraintId 定位约束文件删除
- 未命中时按语义引用（表 + 列 + 类型）在磁盘搜索约束文件匹配删除
- 使用文件锁保护删除操作

设计背景:
- 约束 ID 已 UUID 化，"类型+表+列"现场重算派生 ID 找文件的方式对表/列改名
  必然失配；语义搜索读文件内容匹配，对存量语义 ID 文件与新 UUID 文件同样适用

输入示例:
    success, message = delete_constraint_file(
        {"type": "NotNull", "tableName": "users", "targetColumn": "email"}, "/workspace"
    )

输出示例:
    (True, "notnull_users_email")
"""

from __future__ import annotations

import logging
from typing import Any

from app.shared.services.llm.constraints.constraint_builder import CONSTRAINT_TYPE_MAP
from app.shared.services.llm.constraints.constraint_lookup import (
    find_constraint_file_by_id,
    find_constraint_file_by_semantics,
    sanitize_constraint_id,
)
from app.shared.services.llm.yaml_io import FileLock

logger = logging.getLogger(__name__)


def delete_constraint_file(constraint_spec: dict[str, Any], workspace_path: str) -> tuple[bool, str]:
    """
    @methoddesc 删除独立约束文件

    定位顺序：显式 constraintId（文件名安全清洗后按内容 id / 文件名匹配）优先；
    未命中或未提供时按语义引用（表 + 列 + 类型）扫描 constraints/ 目录匹配。
    使用文件锁保护删除操作，防止并发冲突。

    参数:
        constraint_spec: 约束动作 spec（type / tableName / targetColumn /
            constraintId 等，与写盘路径同源）
        workspace_path: 工作区路径

    返回:
        元组 (是否成功, 被删文件的真实约束 ID 或错误信息)。成功时 message
        即磁盘文件的真实 id（manifest 清理与前端信封 entityId 直接复用，
        不再重新派生）
    """
    constraint_type = constraint_spec.get("type", "")
    std_type = CONSTRAINT_TYPE_MAP.get(constraint_type, constraint_type)

    try:
        explicit_id = sanitize_constraint_id(constraint_spec.get("constraintId"))
    except ValueError as e:
        logger.warning(f"[updateYamlConfig] {e}")
        return False, str(e)

    located = find_constraint_file_by_id(workspace_path, explicit_id) if explicit_id else None
    if located is None:
        located = find_constraint_file_by_semantics(
            workspace_path,
            std_type,
            table_name=constraint_spec.get("tableName", ""),
            target_node_id=constraint_spec.get("targetNodeId", ""),
            target_column=constraint_spec.get("targetColumn", ""),
            target_column_id=constraint_spec.get("targetColumnId", ""),
            target_columns=constraint_spec.get("targetColumnIds") or constraint_spec.get("targetColumns") or [],
        )

    if located is None:
        target_desc = f"{std_type} on {constraint_spec.get('tableName', '')}.{constraint_spec.get('targetColumn', '')}"
        error_msg = f"约束文件不存在: {target_desc}" + (f"（id={explicit_id}）" if explicit_id else "")
        logger.warning(f"[updateYamlConfig] {error_msg}")
        return False, error_msg

    real_id, constraint_file_path = located
    try:
        with FileLock(str(constraint_file_path)):
            if not constraint_file_path.exists():
                error_msg = f"约束文件不存在: {constraint_file_path}"
                logger.warning(f"[updateYamlConfig] {error_msg}")
                return False, error_msg
            constraint_file_path.unlink()
            logger.info(f"[updateYamlConfig] 成功删除约束文件: {constraint_file_path}")
            return True, real_id
    except Exception as e:
        error_msg = f"删除约束文件失败: {str(e)}"
        logger.error(f"[updateYamlConfig] {error_msg}")
        return False, error_msg
