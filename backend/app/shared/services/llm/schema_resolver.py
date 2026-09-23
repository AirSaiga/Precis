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
@fileoverview Schema 查找与 ID 解析模块

功能概述:
- 在工作区的 schemas 目录中按名称查找匹配的表
- 支持精确匹配和模糊包含匹配
- 根据表名/列名反向解析对应的系统 ID

输入示例:
    matches = find_matching_schemas("/path/to/project", "users")
    table_id, column_id = _resolve_id_from_name("/path/to/project", "users", "email")

输出示例:
    [{"id": "sc_xxx", "name": "系统用户表"}]
    ("sc_xxx", "col_email")
"""

from __future__ import annotations

import logging
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


def find_matching_schemas(workspace_path: str, query_name: str) -> list[dict[str, str]]:
    """
    @methoddesc 在本地 schema 文件中查找匹配的表

    支持精确匹配和模糊包含匹配，优先返回精确匹配结果。

    参数:
        workspace_path: 工作区路径
        query_name: 用户提供的名称 (可能是 table_id, tableName 或 targetNodeId)

    返回:
        匹配到的候选列表: [{"id": "sc_xxx", "name": "系统用户表"}]

    示例:
        >>> find_matching_schemas("/workspace", "users")
        [{"id": "users", "name": "users"}]
    """
    if not query_name:
        return []

    schemas_dir = Path(workspace_path) / "schemas"
    if not schemas_dir.exists():
        return []

    exact_matches = []
    fuzzy_matches = []

    query_name_lower = query_name.lower()

    for schema_file in schemas_dir.glob("*.yaml"):
        try:
            with open(schema_file, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}

            table_id = data.get("id")
            table_name = data.get("name")

            if not table_id or not table_name:
                continue

            # 1. 精确匹配 (ID 或 Name 完全一致)
            if query_name == table_id or query_name == table_name:
                exact_matches.append({"id": table_id, "name": table_name})
                continue

            # 2. 模糊匹配 (包含关系)
            if query_name_lower in table_name.lower() or query_name_lower in table_id.lower():
                fuzzy_matches.append({"id": table_id, "name": table_name})

        except Exception as e:
            logger.warning(f"检索 Schema 失败 {schema_file}: {e}")
            continue

    # 如果有精确匹配，优先返回精确匹配
    return exact_matches if exact_matches else fuzzy_matches


def _resolve_id_from_name(
    workspace_path: str, table_name: str, column_name: str | None = None
) -> tuple[str | None, str | None]:
    """
    @methoddesc 根据名称在本地 schema 文件中查找对应的 ID

    仅返回第一个匹配项，用于自动化流程中的名称到 ID 解析。

    列引用解析约定(与内嵌约束收集一致,严格精确匹配,无任何兜底):
    顶层列用裸名,嵌套子列用「父.子」点分路径;不接受列 ID。

    参数:
        workspace_path: 工作区路径
        table_name: 表名或表 ID
        column_name: 列引用(可选): 顶层列名 / 嵌套全限定路径

    返回:
        元组 (table_id, column_id)，如果未找到则返回 (None, None)
    """
    matches = find_matching_schemas(workspace_path, table_name)
    if not matches:
        return None, None

    # 获取第一个匹配的表 ID
    table_id = matches[0]["id"]
    column_id = None

    # 如果有列引用，按「全限定名精确匹配 -> 列 ID 兜底」解析
    if column_name:
        schemas_dir = Path(workspace_path) / "schemas"
        for schema_file in schemas_dir.glob("*.yaml"):
            try:
                with open(schema_file, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                if data.get("id") == table_id:
                    column_id = _resolve_column_ref(data.get("columns", []), column_name)
                    break
            except Exception:
                logger.warning(f"解析 Schema 文件失败: {schema_file}", exc_info=True)
                continue

    return table_id, column_id


def _resolve_column_ref(columns: list[dict], ref: str) -> str | None:
    """按列引用精确解析列 ID:仅接受顶层裸名 / 嵌套「父.子」全限定路径,无任何兜底。

    :param columns: schema 文件的顶层列定义列表(原始 dict)
    :param ref: 列引用字符串
    :return: 匹配的列 ID,未找到返回 None
    """
    name_to_id: dict[str, str] = {}

    def walk(cols: list[dict], parent_path: str) -> None:
        prefix = f"{parent_path}." if parent_path else ""
        for col in cols:
            name = col.get("name")
            col_id = col.get("id")
            if name and col_id:
                key = f"{prefix}{name}"
                if key not in name_to_id:
                    name_to_id[key] = col_id
            children = col.get("children")
            if children:
                walk(children, f"{prefix}{name}" if name else parent_path)

    walk(columns or [], "")
    return name_to_id.get(ref)
