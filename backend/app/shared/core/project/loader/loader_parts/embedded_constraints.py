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
@fileoverview 内嵌约束收集模块

功能概述:
- 从 Schema 文件中收集内嵌的约束定义
- 将 Schema 文件中的 inline 约束转换为独立的 ConstraintFile

架构设计:
- 扫描所有 schema 的 constraints 字段
- 转换约束引用: 全限定列名 -> column id (规范化)

列引用约定(精确匹配,不做递归裸名猜测):
- 顶层列用裸名: `email` 仅匹配顶层列 email
- 嵌套子列用「父.子」点分路径: `customer.email` 仅匹配 customer 下的 email
- 未命中的引用原样保留(兼容直接写列 ID 的引用,真正不存在时由 factory 阶段报错)

输入示例:
    schema_files = {
        "users": TableSchemaFile(
            id="users",
            name="用户表",
            columns=[
                Column(id="col_1", name="id", type="integer"),
                Column(id="col_2", name="username", type="string"),
                Column(id="col_3", name="email", type="string")
            ],
            constraints=[
                ConstraintItem(
                    id="not_null_username",
                    type="NotNull",
                    column="username",  # 列名 (需要转换为 id)
                    enabled=True
                ),
                ConstraintItem(
                    id="fk_orders",
                    type="ForeignKey",
                    from_column="user_id",
                    to_table="users",
                    to_column="id",
                    enabled=True
                )
            ]
        )
    }

输出示例:
    constraint_files = {
        "users_not_null_username": ConstraintFile(
            version=2,
            id="users_not_null_username",
            type="NotNull",
            enabled=True,
            refs={"table_id": "users", "column_id": "col_2"},
            params={}
        ),
        "users_fk_orders": ConstraintFile(
            version=2,
            id="users_fk_orders",
            type="ForeignKey",
            enabled=True,
            refs={
                "from_table_id": "users",
                "from_column_id": "user_id",  # 保持原名（未找到对应 column）
                "to_table_id": "users",
                "to_column_id": "id"
            },
            params={}
        )
    }
"""

from __future__ import annotations

from typing import Any, cast

from app.shared.core.project.constraint.registry import normalize_constraint_type
from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.loader.types import LoadingError
from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.core.project.schema.types_parts.column_utils import build_qualified_name_to_id_map


def collect_constraints_from_schemas(
    schema_files: dict[str, TableSchemaFile],
    loading_errors: list[LoadingError] | None = None,
    schema_paths: dict[str, str] | None = None,
) -> dict[str, ConstraintFile]:
    """@methoddesc 从 Schema 文件中收集内嵌约束

    遍历所有 Schema，提取其中的 constraints 字段，
    转换为独立的 ConstraintFile 对象。

    核心转换逻辑:
    1. 约束 ID: "{table_id}_{constraint_id}" 格式，确保全局唯一
    2. 列引用: 全限定列名 -> column id (顶层裸名/嵌套点分路径,精确匹配)
    3. 外键特殊处理: from_column/to_column 也需要转换

    列引用规则 (严格模式,无任何兜底):
        `column` / `columns` / `from_column` / `to_column` 只接受顶层列裸名
        或嵌套「父.子」全限定路径;解析不到视为配置错误,记入 loading_errors
        并丢弃该约束(不猜测、不当作列 ID 直通)。列 ID 只出现在 column_id /
        column_ids 等 ID 字段(独立约束文件、Conditional 的 then_column_id)。

    输入示例:
        schema_files = {
            "users": TableSchemaFile(
                id="users",
                constraints=[
                    ConstraintItem(
                        id="not_null_email",
                        type="NotNull",
                        column="email",  # 列名
                        enabled=True,
                        params={}
                    )
                ]
            )
        }

    输出示例:
        constraint_files = {
            "users_not_null_email": ConstraintFile(
                version=2,
                id="users_not_null_email",
                type="NotNull",
                enabled=True,
                refs={"table_id": "users", "column_id": "col_3"},  # email 的 column id
                params={}
            )
        }

    原理说明:
        - normalize_constraint_type() 确保约束类型名称标准化 (如 "not null" -> "NotNull")
        - 列引用到列 ID 的转换: 按「顶层裸名 / 嵌套「父.子」全限定路径」精确匹配,
          不做递归裸名猜测;未命中即报错并丢弃该约束
        - ConstraintFile.version 固定为 2 (当前版本)
    """
    # 用于存储转换后的约束文件对象，键为约束全局唯一 ID
    constraint_files: dict[str, ConstraintFile] = {}
    # 遍历所有已加载的 Schema 文件
    for schema in schema_files.values():
        # 如果当前 Schema 没有定义任何内嵌约束，则直接跳过
        if not schema.constraints:
            continue

        # 全限定列名 -> column_id 解析表:顶层列用裸名,嵌套列用「父.子」点分路径,
        # 精确匹配不做递归裸名猜测(避免同名子列误绑定)
        ref_to_id = build_qualified_name_to_id_map(schema.columns)

        def _report_bad_ref(constraint_id: str, ref: str) -> None:
            """列引用无法解析:结构化报错(调用方传入 loading_errors 时)。"""
            if loading_errors is None:
                return
            loading_errors.append(
                LoadingError(
                    error_type="EmbeddedColumnRefError",
                    file_path=(schema_paths or {}).get(schema.id, ""),
                    ref_id=constraint_id,
                    severity="blocker",
                    title="内嵌约束的列引用无法解析",
                    message=f"约束 '{constraint_id}' 引用的列 '{ref}' 在表 '{schema.id}' 中不存在",
                    suggestion=(
                        "顶层列用裸名（如 email），嵌套子列用「父.子」全限定路径（如 customer.email）；"
                        f"可用列: {sorted(ref_to_id)}"
                    ),
                )
            )

        # 遍历该 Schema 中定义的每一条内嵌约束
        for constraint_item in schema.constraints:
            # 将约束类型名称标准化（如 "not null" 转换为 "NotNull"）
            constraint_type = normalize_constraint_type(constraint_item.type)

            # 初始化 refs 字典，至少包含当前表 ID
            refs: dict[str, Any] = {"table_id": schema.id}
            # 约束是否因列引用无法解析而被丢弃
            dropped = False
            # 通用名称字段解析（Conditional 除外：其 column 字段承载 THEN 列 ID，属 ID 语义）
            if constraint_type != "Conditional" and constraint_item.column:
                col_id = ref_to_id.get(constraint_item.column)
                if col_id is None:
                    _report_bad_ref(f"{schema.id}_{constraint_item.id}", constraint_item.column)
                    dropped = True
                else:
                    refs["column_id"] = col_id
            elif constraint_type != "Conditional" and constraint_item.columns:
                column_ids = []
                for col_name in constraint_item.columns:
                    col_id = ref_to_id.get(col_name)
                    if col_id is None:
                        _report_bad_ref(f"{schema.id}_{constraint_item.id}", col_name)
                        dropped = True
                        break
                    column_ids.append(col_id)
                if not dropped:
                    refs["column_ids"] = column_ids

            # 外键约束需要特殊处理：涉及源列和目标列的映射
            if not dropped and constraint_type == "ForeignKey":
                # 源列引用（顶层列名或嵌套全限定路径）解析为列 ID（未命中报错丢弃）
                from_col_id = None
                if constraint_item.from_column:
                    from_col_id = ref_to_id.get(constraint_item.from_column)
                    if from_col_id is None:
                        _report_bad_ref(f"{schema.id}_{constraint_item.id}", constraint_item.from_column)
                        dropped = True

                # 对目标列也执行列引用 → 列 ID 的转换（在目标 schema 中按同一约定严格解析）
                to_col_id = constraint_item.to_column
                if not dropped and constraint_item.to_table and constraint_item.to_column:
                    to_schema = schema_files.get(constraint_item.to_table)
                    if to_schema:
                        to_ref_to_id = build_qualified_name_to_id_map(to_schema.columns)
                        to_col_id = to_ref_to_id.get(constraint_item.to_column)
                        if to_col_id is None:
                            _report_bad_ref(f"{schema.id}_{constraint_item.id}", constraint_item.to_column)
                            dropped = True

                if not dropped:
                    # 外键的 refs 结构包含源表/列和目标表/列
                    refs = {
                        "from_table_id": schema.id,
                        "from_column_id": from_col_id,
                        "to_table_id": constraint_item.to_table,
                        "to_column_id": to_col_id,
                    }

            if dropped:
                continue

            # Conditional 约束：将 params 中的字段提取到 refs（前端 embedded 约束无 refs 字段）
            # 提取后从 params 中移除，避免下游同时看到 refs 和 params 中的重复字段
            if constraint_type == "Conditional":
                params = dict(constraint_item.params or {})
                refs["if_logic"] = params.pop("if_logic", "and")
                refs["if_conditions"] = params.pop("if_conditions", []) or []
                refs["then_column_id"] = params.pop("then_column_id", None)
                params.pop("table_id", None)
            else:
                params = constraint_item.params or {}

            # 构建 ConstraintFile 对象，将内嵌约束转换为独立约束文件格式
            cf = ConstraintFile.model_construct(
                version=2,
                id=f"{schema.id}_{constraint_item.id}",  # 使用 "{table_id}_{constraint_id}" 确保全局唯一
                type=cast(Any, constraint_type),
                enabled=constraint_item.enabled,
                refs=refs,
                params=params,
            )
            # 以全局唯一 ID 为键存入字典
            constraint_files[cf.id] = cf

    # 返回所有收集到的约束文件对象
    return constraint_files
