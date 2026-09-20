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

import re
from typing import Any

from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.domain.dataset_schema import DataSetSchema

# UUID 形态（任意版本）：8-4-4-4-12 十六进制。表 ID 均为该形态，而真实
# 表名/列名/文件名不可能撞上该格式，用正则做文本内 ID→名称替换零误伤。
_UUID_TOKEN_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

# 条目中可能内嵌表 ID 的文本字段（message 为域约束/格式错误主文本，
# description 为 constraint_checks 描述，suggestion 为加载错误修复建议）
_ID_TEXT_FIELDS = ("message", "error_message", "description", "suggestion")


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


def attach_source_info(
    item: dict[str, Any],
    table_source_map: dict[str, dict[str, str | None]],
    name_to_id: dict[str, str] | None = None,
) -> None:
    """将数据源信息附加到错误/通过项字典中。

    根据 item 中的 table 或 table_id 查找对应的数据源配置，
    并将 source_file 和 source_sheet 写入 item。

    §1.30: postprocess_result 先 map_table_id（把 table 换成显示名）再 attach——
    约束错误条目只有 table 键（无 table_id），被换成显示名后直查恒 miss。
    这里按 name_to_id 反查回退，约束错误与格式错误同样获得 source_file 定位。

    参数:
        item: 包含 table/table_id 的字典（会被就地修改）
        table_source_map: 表 ID → 数据源信息的映射
        name_to_id: 显示名 → 表 ID 的反查映射（可选）
    """
    table_id = item.get("table_id") or item.get("table")
    if table_id not in table_source_map and name_to_id and table_id in name_to_id:
        table_id = name_to_id[table_id]
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
            # 重写为显示名前保留原 ID 到 {key}_id（不覆盖已有键）：下游按 ID
            # 定位的消费方（json_payload 的 tables 行数查 raw_datasets、
            # attach_source_info 直查）不因显示名化而失联
            id_key = f"{key}_id"
            if id_key not in item:
                item[id_key] = item[key]
            item[key] = id_to_name[item[key]]


def rewrite_id_tokens(text: Any, id_to_name: dict[str, str]) -> Any:
    """将文本中 UUID 形态的表 ID 替换为显示名称（查不到映射时原样保留）。

    域约束构造时注入的 from_table/to_table 等字段是数据集查表键（表 ID），
    错误消息/描述里直接插值导致用户看到 UUID 而非表名。map_table_id 只
    重写条目顶层字段，不碰文本，这里补齐文本侧。悬空引用（表已不存在，
    无名称可映射）保留原 ID——那是用户在配置里定位它的唯一线索。

    参数:
        text: 任意取值（非字符串原样返回）
        id_to_name: 表 ID 到显示名称的映射

    返回:
        重写后的文本（或原值）
    """
    if not isinstance(text, str) or not id_to_name:
        return text

    def _replace(match: re.Match[str]) -> str:
        token = match.group(0)
        # 映射键为存储原值（通常小写）；正则大小写不敏感，双口径查一次
        return id_to_name.get(token, id_to_name.get(token.lower(), token))

    return _UUID_TOKEN_RE.sub(_replace, text)


def humanize_item_texts(item: dict[str, Any], id_to_name: dict[str, str]) -> None:
    """就地重写条目文本字段中 UUID 形态的表 ID 为显示名称。

    参数:
        item: 错误/检查条目字典（会被就地修改）
        id_to_name: 表 ID 到显示名称的映射
    """
    for key in _ID_TEXT_FIELDS:
        if key in item:
            item[key] = rewrite_id_tokens(item[key], id_to_name)


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
    # 显示名 → 表 ID 反查（§1.30: map_table_id 先行把约束错误的 table 换成显示名，
    # attach 需要反查才能命中；同名的多表取后者，展示层容错）
    name_to_id = {name: tid for tid, name in id_to_name.items()}

    for error in result["errors"]:
        map_table_id(error, id_to_name)
        humanize_item_texts(error, id_to_name)
        attach_source_info(error, table_source_map, name_to_id)
    for error in result["loading_errors"]:
        map_table_id(error, id_to_name)
        humanize_item_texts(error, id_to_name)
        attach_source_info(error, table_source_map, name_to_id)
    if "format_checks" in result["validation_details"]:
        for item in result["validation_details"]["format_checks"]:
            map_table_id(item, id_to_name)
            humanize_item_texts(item, id_to_name)
            attach_source_info(item, table_source_map, name_to_id)
    if "constraint_checks" in result["validation_details"]:
        for item in result["validation_details"]["constraint_checks"]:
            map_table_id(item, id_to_name)
            humanize_item_texts(item, id_to_name)
            attach_source_info(item, table_source_map, name_to_id)
