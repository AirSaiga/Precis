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
"""@fileoverview Schema 引用扫描（REST 删除守卫与 AI DELETE_SCHEMA 共用，§2.6）

删除 Schema 前扫描 constraints/regex/transforms 三类实体对该表的引用，
返回引用清单供调用方决定拒绝（REST 409 / AI 失败消息）——单一事实源防两路再漂移。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from app.shared.core.io.yaml import read_yaml
from app.shared.core.project.manifest.reader import load_manifest


def find_schema_references(workspace_path: str, table_id: str) -> dict[str, list[str]]:
    """扫描引用指定 schema 的实体。

    Args:
        workspace_path: 项目根目录（含 project.precis.yaml）
        table_id: 目标表 ID

    Returns:
        {"constraints": [引用方 id...], "regex": [...], "transforms": [...]}
        单个引用文件读取失败时跳过（容错与原 REST 守卫一致，不因损坏文件阻断删除）。
    """
    result: dict[str, list[str]] = {"constraints": [], "regex": [], "transforms": []}
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return result

    manifest = load_manifest(manifest_path)

    for c_ref in manifest.constraints:
        try:
            c_path = os.path.join(workspace_path, c_ref.path)
            if os.path.isfile(c_path):
                refs_data = (read_yaml(Path(c_path)) or {}).get("refs", {})
                if (
                    refs_data.get("table_id") == table_id
                    or refs_data.get("from_table_id") == table_id
                    or refs_data.get("to_table_id") == table_id
                ):
                    result["constraints"].append(c_ref.id)
        except Exception:
            continue

    for r_ref in manifest.regex_nodes or []:
        try:
            r_path = os.path.join(workspace_path, r_ref.path)
            if os.path.isfile(r_path):
                source_ref = (read_yaml(Path(r_path)) or {}).get("source_ref", {})
                if source_ref.get("table_id") == table_id:
                    result["regex"].append(r_ref.id)
        except Exception:
            continue

    for t_ref in manifest.transforms or []:
        try:
            t_path = os.path.join(workspace_path, t_ref.path)
            if os.path.isfile(t_path):
                t_data: dict[str, Any] = read_yaml(Path(t_path)) or {}
                if t_data.get("input_from_node") == table_id:
                    result["transforms"].append(t_ref.id)
        except Exception:
            continue

    return result


def format_reference_report(refs: dict[str, list[str]]) -> str:
    """把引用清单格式化为用户可读的单行报告（空清单返回空串）。"""
    parts = []
    label_map = [("constraints", "constraint"), ("regex", "regex"), ("transforms", "transform")]
    for key, label in label_map:
        ids = refs.get(key) or []
        if ids:
            parts.append(f"{label} {', '.join(ids)}")
    return "、".join(parts)
