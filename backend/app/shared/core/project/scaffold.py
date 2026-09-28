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
"""@fileoverview 项目脚手架 — 最小 manifest 模板与标准子目录的单一事实源

消费方（消灭两处模板漂移）：
- Web 端新建项目 API（api/routers/projects/create.py）
- AI 初始化动作 INIT_PROJECT（llm/actions/project_handlers.py）与各资源
  handler 的 `_ensure_manifest_*_ref` 兜底（manifest 缺失时自动补脚手架，
  杜绝"schema 已写盘但无处登记"的孤儿文件路径）
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from app.shared.core.io.yaml import write_yaml_atomic

logger = logging.getLogger(__name__)

# 标准项目子目录（regex/ 为 V2 约定目录，regex_nodes/ 为历史兼容目录，两者都建）
REQUIRED_SUBDIRS: list[str] = [
    "schemas",
    "constraints",
    "regex_nodes",
    "regex",
    "transforms",
    "patterns",
    "templates",
    "data",
    ".precis",
]

# manifest 文件名常量（全仓多处引用，收编于此供消费方共用）
MANIFEST_FILENAME = "project.precis.yaml"


def build_min_manifest(project_name: str) -> dict:
    """根据项目名构造最小可用 manifest（dict 形态，未序列化）。

    id 由项目名派生：小写 + 仅保留字母数字与下划线（中文名会退化为下划线串，
    与 Web 端新建项目行为一致）。
    """
    raw_id = re.sub(r"[^a-zA-Z0-9_]", "_", project_name.strip().lower()) or "project"
    return {
        "version": 2,
        "project": {"id": raw_id, "name": project_name},
        "settings": {
            "validation": {
                "auto_validate": False,
                "strict_mode": False,
                "error_handling": "continue",
                "timeout_seconds": 30,
            },
            "file_processing": {"default_encoding": "utf-8"},
            "script_security": {"allow_eval": False, "allow_exec": False},
        },
        "schemas": [],
        "constraints": [],
        "regex_nodes": [],
        "transforms": [],
        "data_sources": [],
        "templates": [],
        "template_instances": [],
        "patterns_dir": "patterns",
        "warnings": [],
    }


def ensure_manifest_exists(workspace_path: str | Path) -> Path:
    """确保 manifest 存在；缺失时创建最小脚手架（幂等，已存在则原样返回）。

    作为各资源 handler 写盘后登记引用的兜底：manifest 缺失时不再静默跳过
    登记（产出孤儿文件），而是先补一个最小 manifest 再登记。项目名取目录名。
    """
    workspace = Path(workspace_path)
    manifest_path = workspace / MANIFEST_FILENAME
    if manifest_path.exists():
        return manifest_path

    for sub in REQUIRED_SUBDIRS:
        (workspace / sub).mkdir(parents=True, exist_ok=True)

    project_name = workspace.resolve().name or "project"
    write_yaml_atomic(manifest_path, build_min_manifest(project_name))
    logger.info(f"[scaffold] manifest 缺失，已创建最小项目清单: {manifest_path}（项目名: {project_name}）")
    return manifest_path
