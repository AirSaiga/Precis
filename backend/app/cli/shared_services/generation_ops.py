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
# backend/app/cli/shared_services/generation_ops.py
"""
@fileoverview 生成/迁移配置落盘共享逻辑（CLI/TUI 同源）

功能概述:
- 收敛 AI 配置生成与迁移的纯业务逻辑：生成结果落盘、数据文件扫描与展开
- 供 CLI 的 ai generate / ai migrate 命令与未来 TUI 的生成/迁移屏共同调用

架构设计:
- 本模块只含纯逻辑与文件 IO，不含任何 UI/交互
- apply_generated_config 复用 V2 配置写入约定（project.precis.yaml + schemas/ + constraints/ + regex/）
- scan_data_files 统一 patterns 展开与 data/ 目录扫描两种入口

接口契约（P0b 冻结）:
    def apply_generated_config(result: dict, project_path: str) -> list[str]
    def scan_data_files(patterns: list[str], project_path: str) -> list[str]
"""

from __future__ import annotations

import glob
import logging
import os
import re
from pathlib import Path
from typing import Any

from app.shared.core.io.yaml import read_yaml, write_yaml_atomic

logger = logging.getLogger(__name__)

# 支持的文件扩展名（generate/migrate 共用）
SUPPORTED_EXTENSIONS = (".xlsx", ".xls", ".csv", ".json", ".jsonl")

# 实体 id 安全白名单：字母/数字/下划线/连字符（H10——LLM 生成的 id 未消毒即拼盘
# 路径时，`../../evil` 类路径成分可越项目写文件/建目录，写盘前须拒绝）
_SAFE_ENTITY_ID_RE = re.compile(r"[A-Za-z0-9_-]+")


def _filter_safe_entity_ids(entities: dict[str, Any], kind: str) -> dict[str, Any]:
    """过滤掉含路径成分或非法字符的实体 id，记录错误日志（H10）。

    Returns:
        仅保留安全 id 的实体字典；非法 id 整体跳过（不写盘、不进 manifest 引用）
    """
    safe: dict[str, Any] = {}
    for eid, body in entities.items():
        if isinstance(eid, str) and _SAFE_ENTITY_ID_RE.fullmatch(eid):
            safe[eid] = body
        else:
            logger.error("跳过非法实体 id（含路径成分或非法字符，kind=%s）: %r", kind, eid)
    return safe


def scan_data_files(patterns: list[str], project_path: str) -> list[str]:
    """展开数据文件路径（支持通配符、相对路径、data/ 目录扫描）。

    逻辑：
    1. 若 patterns 非空：逐个展开通配符 / 直连存在的路径，合并去重
    2. 若 patterns 为空（或展开后为空）：扫描项目 data/ 目录下的支持文件
    3. 最终按 SUPPORTED_EXTENSIONS 过滤

    Args:
        patterns: 用户输入的文件模式列表（可为相对项目根的路径或通配符）
        project_path: 项目根目录绝对路径

    Returns:
        绝对路径列表（已去重、已排序的 data/ 扫描部分 + 保持展开顺序的 patterns 部分）
    """
    file_paths: list[str] = []
    for pattern in patterns:
        if not os.path.isabs(pattern):
            pattern = os.path.join(project_path, pattern)
        matched = glob.glob(pattern)
        if matched:
            file_paths.extend(matched)
        elif os.path.exists(pattern):
            file_paths.append(pattern)

    # 合并去重（保序）
    file_paths = list(dict.fromkeys(file_paths))

    # 无文件参数时扫描 data/ 目录（保持原 _scan_data_files 行为）
    if not file_paths:
        data_dir = Path(project_path) / "data"
        if data_dir.exists():
            for ext in SUPPORTED_EXTENSIONS:
                file_paths.extend(str(p) for p in data_dir.glob(f"*{ext}"))
            # 扫描分支输出排序，保证结果稳定
            file_paths.sort()

    # 过滤支持的文件类型
    return [p for p in file_paths if p.lower().endswith(SUPPORTED_EXTENSIONS)]


def apply_generated_config(result: dict[str, Any], project_path: str) -> list[str]:
    """将生成的配置写入项目目录。

    保留策略为并集（R6）：生成 manifest 未携带的既有顶层键（project/settings/
    templates/data_sources 等）一律保留，防止空/局部 manifest 清空既有配置；
    schemas、constraints、regex_nodes 引用则始终按生成结果覆盖写入。

    Args:
        result: ConfigGenerationService / ConfigMigrationService 返回的配置字典
        project_path: 项目根目录

    Returns:
        已写入的文件相对路径列表（manifest + 各 schema/constraint/regex 文件）
    """
    written: list[str] = []

    manifest_path = Path(project_path) / "project.precis.yaml"
    existing_manifest: dict[str, Any] = {}
    if manifest_path.exists():
        try:
            existing_manifest = read_yaml(manifest_path) or {}
        except Exception:
            logger.warning("读取现有 manifest 失败，将覆盖写入", exc_info=True)

    generated_manifest = result.get("manifest")
    if generated_manifest:
        manifest = dict(generated_manifest)
    else:
        # LLM 未返回 manifest：以现有 manifest 为底仅补最小骨架，
        # 不再制造空 project 兜底清空既有 project.id/settings（R6）
        manifest = dict(existing_manifest)
        manifest.setdefault("version", 2)
        manifest.setdefault("project", {"id": "", "name": ""})

    # 保留策略并集（R6）：生成 manifest 未携带的既有键一律保留
    for key, value in existing_manifest.items():
        if key not in manifest:
            manifest[key] = value

    schemas = _filter_safe_entity_ids(result.get("schemas", {}) or {}, "schema")
    constraints = _filter_safe_entity_ids(result.get("constraints", {}) or {}, "constraint")
    regex_nodes = _filter_safe_entity_ids(result.get("regex_nodes", {}) or {}, "regex")

    # 确保目录存在
    (Path(project_path) / "schemas").mkdir(exist_ok=True)
    (Path(project_path) / "constraints").mkdir(exist_ok=True)
    (Path(project_path) / "regex").mkdir(exist_ok=True)

    # 更新 manifest 引用
    manifest["schemas"] = [{"id": sid, "path": f"schemas/{sid}.schema.yaml"} for sid in schemas]
    manifest["constraints"] = [{"id": cid, "path": f"constraints/{cid}.constraint.yaml"} for cid in constraints]
    manifest["regex_nodes"] = [{"id": rid, "path": f"regex/{rid}.regex.yaml"} for rid in regex_nodes]

    # 写入 manifest
    write_yaml_atomic(manifest_path, manifest)
    written.append("project.precis.yaml")

    # 写入资源文件
    for sid, schema in schemas.items():
        rel = f"schemas/{sid}.schema.yaml"
        write_yaml_atomic(Path(project_path) / rel, schema)
        written.append(rel)
    for cid, constraint in constraints.items():
        rel = f"constraints/{cid}.constraint.yaml"
        write_yaml_atomic(Path(project_path) / rel, constraint)
        written.append(rel)
    for rid, regex_node in regex_nodes.items():
        rel = f"regex/{rid}.regex.yaml"
        write_yaml_atomic(Path(project_path) / rel, regex_node)
        written.append(rel)

    return written


__all__ = [
    "SUPPORTED_EXTENSIONS",
    "apply_generated_config",
    "scan_data_files",
]
