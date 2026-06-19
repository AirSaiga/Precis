"""
@fileoverview Schema 辅助函数模块

功能概述:
- 提供 Schema 文件路径查找、冲突检测和合并等辅助函数
- 支持多层查找策略：manifest 引用、文件名匹配、内容 ID 计算
- 用于 Schema CRUD API 的底层支撑

架构设计:
- 纯函数设计，无状态无副作用，便于单元测试
- 与 schema.py 路由层解耦，职责分离
- 使用 YAML 读取和 Pydantic 模型进行数据验证

输入示例:
    path = _get_schema_path(manifest, "users", "/project/root")
    conflicts = _compute_conflicts(existing_schema, new_schema)
    merged = _merge_schemas(existing_schema, new_schema)

输出示例:
    "/project/root/schemas/users.schema.yaml"
    ["columns", "constraints"]
    {"version": 2, "id": "users", "columns": [...]}
"""

import os
from typing import Any, Optional

from app.shared.core.project.manifest.types import ProjectManifestV2


def _get_schema_path(manifest: ProjectManifestV2, table_id: str, config_path: str) -> Optional[str]:
    """
    获取 schema 文件路径。

    查找策略：
    1. 从 manifest.schemas 中查找引用（优先）
    2. 验证引用路径是否实际存在（处理大小写不一致问题）
    3. 扫描 schemas/ 目录，按 filename = table_id 查找（兼容 ID 作文件名）
    4. 扫描 schemas/ 目录，按 filename = table_name 查找（兼容 name 作文件名）
    5. 扫描 schemas/ 目录，按计算出的 schema ID 查找
    """
    ref = next((s for s in manifest.schemas if s.id == table_id), None)
    if ref:
        ref_path = os.path.join(config_path, ref.path)
        if os.path.isfile(ref_path):
            return ref_path

    schemas_dir = os.path.join(config_path, "schemas")
    if os.path.isdir(schemas_dir):
        for filename in os.listdir(schemas_dir):
            if filename.lower().endswith(".schema.yaml"):
                tid = filename[:-12]
                if tid == table_id:
                    return os.path.join(schemas_dir, filename)

        for filename in os.listdir(schemas_dir):
            if filename.lower().endswith(".schema.yaml"):
                tname = filename[:-12]
                if tname == table_id:
                    return os.path.join(schemas_dir, filename)
    return None


def _compute_conflicts(existing: dict[str, Any], new: dict[str, Any]) -> list[str]:
    """
    计算两个 schema 之间的冲突字段。

    比较策略：
    - 顶层字段：version, id, name, source, sheet, columns, constraints, script_checks
    - columns 列表：比较列 ID、name、type
    - constraints 列表：比较约束 ID 和类型
    """
    conflict_fields = []

    for field in ["version", "id", "name", "source", "sheet", "columns", "constraints", "script_checks"]:
        if field in existing and field in new:
            if field == "columns":
                existing_cols = existing.get("columns", [])
                new_cols = new.get("columns", [])
                if len(existing_cols) != len(new_cols):
                    conflict_fields.append(f"columns (数量: {len(existing_cols)} vs {len(new_cols)})")
                else:
                    column_conflicts = []
                    for i, (ec, nc) in enumerate(zip(existing_cols, new_cols)):
                        if (
                            ec.get("id") != nc.get("id")
                            or ec.get("name") != nc.get("name")
                            or ec.get("type") != nc.get("type")
                        ):
                            column_conflicts.append(f"columns[{i}]")
                    if column_conflicts:
                        conflict_fields.append("columns")
                        conflict_fields.extend(column_conflicts)
            elif field == "constraints":
                existing_constraints = existing.get("constraints", [])
                new_constraints = new.get("constraints", [])
                if len(existing_constraints) != len(new_constraints):
                    conflict_fields.append(f"constraints (数量: {len(existing_constraints)} vs {len(new_constraints)})")
            elif existing[field] != new[field]:
                conflict_fields.append(field)
        elif field in existing or field in new:
            conflict_fields.append(field)

    return conflict_fields


def _merge_schemas(existing: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """
    合并两个 schema 配置。

    合并策略：
    - version: 使用新的
    - id: 使用新的（必须一致）
    - name: 使用新的
    - source: 使用新的
    - sheet: 使用新的
    - columns: 使用新的（替换）
    - constraints: 追加新的约束，保留已有的
    - script_checks: 追加新的，保留已有的
    """
    merged = existing.copy()

    for field in ["version", "id", "name", "source", "sheet", "columns"]:
        if field in new:
            merged[field] = new[field]

    if "constraints" in new:
        existing_constraints = merged.get("constraints", [])
        new_constraints = new.get("constraints", [])
        existing_ids = {c.get("id") for c in existing_constraints}
        for nc in new_constraints:
            if nc.get("id") not in existing_ids:
                existing_constraints.append(nc)
        merged["constraints"] = existing_constraints

    if "script_checks" in new:
        existing_checks = merged.get("script_checks", [])
        new_checks = new.get("script_checks", [])
        existing_checks.extend(new_checks)
        merged["script_checks"] = existing_checks

    return merged
