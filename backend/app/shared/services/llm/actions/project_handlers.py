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
"""@fileoverview 项目动作处理器模块

功能概述:
- 处理 AI 生成的 INIT_PROJECT 动作（"从零引导项目"的入口）
- 在 manifest 缺失的项目目录创建标准脚手架：project.precis.yaml + 标准子目录
- 复用 core/project/scaffold.py（与 Web 端新建项目 API 共用单一事实源）

架构设计:
- manifest 已存在时拒绝（幂等保护，防止覆盖既有项目清单）
- 不产生 frontendInstructions：manifest 不是画布资源实体（projectRoot 节点已存在）
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.shared.core.io.yaml import write_yaml_atomic
from app.shared.core.project.scaffold import MANIFEST_FILENAME, REQUIRED_SUBDIRS, build_min_manifest

logger = logging.getLogger(__name__)


def process_project_action(action: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """处理 INIT_PROJECT 动作：创建项目清单脚手架。

    参数:
        action: 动作字典，含 actionType=INIT_PROJECT 与可选 projectSpec（name）
        workspace_path: 项目工作区路径

    返回:
        {"success": bool, "message": str}
    """
    action_type = action.get("actionType", "")
    if action_type != "INIT_PROJECT":
        return {"success": False, "message": f"未知的项目动作类型: {action_type}"}

    manifest_path = Path(workspace_path) / MANIFEST_FILENAME
    if manifest_path.exists():
        return {
            "success": False,
            "message": (
                f"项目清单 {MANIFEST_FILENAME} 已存在，无需初始化"
                "（修改设置请用 UPDATE_SETTINGS；查看配置请用 read_project）"
            ),
        }

    # 项目名：spec 显式给出 > 目录名；均缺省时兜底 "项目"
    spec = action.get("projectSpec") or {}
    raw_name = str(spec.get("name") or "").strip()
    project_name = raw_name or Path(workspace_path).resolve().name or "项目"

    for sub in REQUIRED_SUBDIRS:
        (Path(workspace_path) / sub).mkdir(parents=True, exist_ok=True)

    write_yaml_atomic(manifest_path, build_min_manifest(project_name))
    logger.info(f"[ProjectHandler] 初始化项目清单: {manifest_path}（项目名: {project_name}）")
    return {"success": True, "message": f"已创建项目清单 {MANIFEST_FILENAME}（项目名: {project_name}）"}
