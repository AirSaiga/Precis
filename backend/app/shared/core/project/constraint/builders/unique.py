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
"""@fileoverview Unique 约束构建器

Unique 的 column 支持 list 语义（多列联合唯一），与其他单列约束不同，需独立构建器。
"""

from __future__ import annotations

from typing import Any

from .base import BuilderInput, BuilderResult
from .registry import register_builder


@register_builder("Unique")
def build_unique(inp: BuilderInput) -> BuilderResult:
    """Unique: refs {table_id, column_ids | column_id}。

    column_ids 支持列表（多列）或字符串（单列兼容）。
    """
    refs = inp.refs
    table_id = refs.get("table_id")
    col_id = refs.get("column_ids") or refs.get("column_id")
    if not isinstance(table_id, str):
        return {}, "缺少 table_id"
    # 确保 col_id 是列表
    if isinstance(col_id, str):
        col_id = [col_id]
    elif not col_id:
        col_id = []

    kwargs: dict[str, Any] = {"table": table_id}
    # 映射 column_ids -> column_names
    mapped_cols = [inp.column_name_by_table_id.get(table_id, {}).get(str(cid)) for cid in col_id]
    if None in mapped_cols:
        invalid_cols = [cid for cid, name in zip(col_id, mapped_cols) if name is None]
        return {}, f"引用的列不存在: {invalid_cols}"
    kwargs["column"] = mapped_cols
    return kwargs, None
