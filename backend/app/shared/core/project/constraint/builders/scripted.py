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
"""@fileoverview Scripted 约束构建器

column_id 可选（表达式可不绑定到具体列）。
"""

from __future__ import annotations

from .base import BuilderInput, BuilderResult
from .registry import register_builder


@register_builder("Scripted")
def build_scripted(inp: BuilderInput) -> BuilderResult:
    """Scripted: refs {table_id, column_id?}，params {name, expression}。"""
    refs = inp.refs
    table_id = refs.get("table_id")
    col_id = refs.get("column_id")

    if table_id is None:
        # 配置残缺 fail-fast：与 base.resolve_single_column 的"缺少 table_id"同口径，
        # 不再以 table=None 静默构建出语义偷换的约束
        return {}, "缺少 table_id"

    kwargs: dict[str, object] = {"table": table_id}
    # 使用约束 ID 作为默认名称
    kwargs["name"] = inp.params.get("name", inp.const_id)
    kwargs["expression"] = inp.params.get("expression", "")
    # column_id 是可选的；一旦配置则必须映射成功——原实现 .get 链返回 None 时
    # 照样写入 kwargs（column=None 即整行脚本语义），列改名后的失效引用被静默降级
    if col_id:
        col_name = inp.column_name_by_table_id.get(table_id, {}).get(str(col_id))
        if col_name is None:
            return {}, f"引用的列 '{col_id}' 不存在于表 '{table_id}' 中"
        kwargs["column"] = col_name

    return kwargs, None  # type: ignore[return-value]
