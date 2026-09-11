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
"""@fileoverview 校验结果后处理

对校验结果字典做用户可读化加工：内部表 ID 替换为显示名称、附加
数据源文件与 Sheet 信息。纯字典变换，无 I/O 依赖；标准模式与分块
模式共用（ValidationExecutor._postprocess_result 委托至此）。
"""

from __future__ import annotations

from typing import Any

from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.domain.dataset_schema import DataSetSchema


def build_table_source_map(schema_by_id: dict[str, TableSchemaFile]) -> dict[str, dict[str, str | None]]:
    """构建表 ID 到数据源信息的映射字典。

    用于在校验结果中附加数据源文件名和 Sheet 名，
    使前端能够显示"配置文件内定义的文件名+Sheet名"格式的位置信息。

    参数:
        schema_by_id: 表 ID 到 Schema 文件的映射

    返回:
        映射字典，键为表 ID，值为 {"source_file": ..., "source_sheet": ...}
    """
    result: dict[str, dict[str, str | None]] = {}
    for table_id, schema_file in schema_by_id.items():
        source_file = None
        source_sheet = None
        if schema_file.source:
            source_file = schema_file.source.path
            source_sheet = schema_file.source.sheet
        if not source_sheet and schema_file.sheet:
            source_sheet = schema_file.sheet
        result[table_id] = {"source_file": source_file, "source_sheet": source_sheet}
    return result


def attach_source_info(item: dict[str, Any], table_source_map: dict[str, dict[str, str | None]]) -> None:
    """将数据源信息附加到错误/通过项字典中。

    根据 item 中的 table 或 table_id 查找对应的数据源配置，
    并将 source_file 和 source_sheet 写入 item。

    参数:
        item: 包含 table/table_id 的字典（会被就地修改）
        table_source_map: 表 ID → 数据源信息的映射
    """
    table_id = item.get("table_id") or item.get("table")
    if table_id and table_id in table_source_map:
        item["source_file"] = table_source_map[table_id]["source_file"]
        item["source_sheet"] = table_source_map[table_id]["source_sheet"]


def build_id_to_name_map(dataset_schema: DataSetSchema) -> dict[str, str]:
    """构建表 ID 到显示名称的映射字典。

    用于在校验结果中将内部表 ID 替换为用户友好的表名称。

    参数:
        dataset_schema: 数据集 Schema 定义

    返回:
        映射字典，键为表 ID，值为表显示名称
    """
    id_to_name: dict[str, str] = {}
    if dataset_schema and dataset_schema.tables:
        for tid, schema in dataset_schema.tables.items():
            target_name = schema.name or tid
            if schema.id:
                id_to_name[schema.id] = target_name
            id_to_name[tid] = target_name
    return id_to_name


def map_table_id(item: dict[str, Any], id_to_name: dict[str, str]) -> None:
    """将错误信息中的表 ID 替换为表显示名称。

    就地修改传入的字典，将 table/from_table/to_table 字段中的
    内部 ID 替换为用户可读的名称。

    参数:
        item: 包含表相关字段的错误信息字典
        id_to_name: ID 到名称的映射字典
    """
    for key in ("table", "from_table", "to_table"):
        if key in item and item[key] in id_to_name:
            item[key] = id_to_name[item[key]]


def postprocess_result(
    result: dict[str, Any], dataset_schema: DataSetSchema, schema_by_id: dict[str, TableSchemaFile]
) -> None:
    """对校验结果做统一后处理（ID→名称映射 + 数据源信息附加，就地修改）。

    遍历 errors / loading_errors / validation_details 中的全部条目，
    逐项应用 map_table_id 与 attach_source_info。

    参数:
        result: 校验结果字典（会被就地修改）
        dataset_schema: 数据集 Schema 定义
        schema_by_id: 表 ID 到 Schema 文件的映射
    """
    id_to_name = build_id_to_name_map(dataset_schema)
    table_source_map = build_table_source_map(schema_by_id)

    for error in result["errors"]:
        map_table_id(error, id_to_name)
        attach_source_info(error, table_source_map)
    for error in result["loading_errors"]:
        map_table_id(error, id_to_name)
        attach_source_info(error, table_source_map)
    if "format_checks" in result["validation_details"]:
        for item in result["validation_details"]["format_checks"]:
            map_table_id(item, id_to_name)
            attach_source_info(item, table_source_map)
    if "constraint_checks" in result["validation_details"]:
        for item in result["validation_details"]["constraint_checks"]:
            map_table_id(item, id_to_name)
            attach_source_info(item, table_source_map)
