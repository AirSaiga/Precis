"""
@fileoverview 内嵌约束收集模块

功能概述:
- 从 Schema 文件中收集内嵌的约束定义
- 将 Schema 文件中的 inline 约束转换为独立的 ConstraintFile

架构设计:
- 扫描所有 schema 的 constraints 字段
- 转换约束引用: column name -> column id (规范化)

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

from typing import Any

from app.shared.core.project.constraint.registry import normalize_constraint_type
from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.schema.types import TableSchemaFile


def collect_constraints_from_schemas(
    schema_files: dict[str, TableSchemaFile],
) -> dict[str, ConstraintFile]:
    """@methoddesc 从 Schema 文件中收集内嵌约束

    遍历所有 Schema，提取其中的 constraints 字段，
    转换为独立的 ConstraintFile 对象。

    核心转换逻辑:
    1. 约束 ID: "{table_id}_{constraint_id}" 格式，确保全局唯一
    2. 列引用: column name -> column id (通过列名查找对应 id)
    3. 外键特殊处理: from_column/to_column 也需要转换

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
        - 列名到列 ID 的转换: 遍历 columns 列表，找到 name 匹配的列，取其 id
        - 如果找不到对应的列，则保持原名（向后兼容）
        - ConstraintFile.version 固定为 2 (当前版本)
    """
    # 用于存储转换后的约束文件对象，键为约束全局唯一 ID
    constraint_files: dict[str, ConstraintFile] = {}
    # 遍历所有已加载的 Schema 文件
    for schema in schema_files.values():
        # 如果当前 Schema 没有定义任何内嵌约束，则直接跳过
        if not schema.constraints:
            continue

        # 遍历该 Schema 中定义的每一条内嵌约束
        for constraint_item in schema.constraints:
            # 将约束类型名称标准化（如 "not null" 转换为 "NotNull"）
            constraint_type = normalize_constraint_type(constraint_item.type)

            # 初始化 refs 字典，至少包含当前表 ID
            refs: dict[str, Any] = {"table_id": schema.id}
            # 如果约束指定了单列名称，则查找对应的列 ID
            if constraint_item.column:
                # 在 schema.columns 中搜索 name 匹配的列，返回其 id；若找不到则保留原名称
                column_id = next(
                    (c.id for c in schema.columns if c.name == constraint_item.column), constraint_item.column
                )
                refs["column_id"] = column_id
            # 如果约束指定了多列名称，则逐个查找对应的列 ID
            elif constraint_item.columns:
                column_ids = []
                for col_name in constraint_item.columns:
                    col_id = next((c.id for c in schema.columns if c.name == col_name), col_name)
                    column_ids.append(col_id)
                refs["column_ids"] = column_ids

            # 外键约束需要特殊处理：涉及源列和目标列的映射
            if constraint_type == "ForeignKey":
                # 查找源列名称对应的列 ID（若找不到则保留原名称）
                from_col_id = (
                    next(
                        (c.id for c in schema.columns if c.name == constraint_item.from_column),
                        constraint_item.from_column,
                    )
                    if constraint_item.from_column
                    else None
                )

                # 对目标列也执行列名 → 列 ID 的转换（在目标 schema 中查找）
                to_col_id = constraint_item.to_column
                if constraint_item.to_table and constraint_item.to_column:
                    to_schema = schema_files.get(constraint_item.to_table)
                    if to_schema:
                        to_col_id = next(
                            (c.id for c in to_schema.columns if c.name == constraint_item.to_column),
                            constraint_item.to_column,
                        )

                # 外键的 refs 结构包含源表/列和目标表/列
                refs = {
                    "from_table_id": schema.id,
                    "from_column_id": from_col_id,
                    "to_table_id": constraint_item.to_table,
                    "to_column_id": to_col_id,
                }

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
            cf = ConstraintFile(
                version=2,
                id=f"{schema.id}_{constraint_item.id}",  # 使用 "{table_id}_{constraint_id}" 确保全局唯一
                type=constraint_type,
                enabled=constraint_item.enabled,
                refs=refs,
                params=params,
            )
            # 以全局唯一 ID 为键存入字典
            constraint_files[cf.id] = cf

    # 返回所有收集到的约束文件对象
    return constraint_files
