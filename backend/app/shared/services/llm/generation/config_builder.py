"""@fileoverview 配置构建器

功能概述:
- 将 LLM 输出、画像数据和现有配置整合为最终的项目配置
- 生成标准 V2 格式的 manifest、schemas、constraints、regex_nodes

输入示例:
    result = build_config(
        project_id="ecommerce",
        project_name="电商数据校验",
        config_path="/path/to/project",
        profiling_data=[...],
        llm_result={"schemas": [...], "constraints": [...]},
        options=GenerationOptions(),
        existing_config=None,
    )

输出示例:
    {"manifest": {...}, "schemas": {...}, "constraints": {...}, "yaml_preview": "..."}
"""

import os
import re
from typing import Any, Optional

import yaml

from app.shared.core.utils.path_utils import make_relative, normalize_to_posix


def build_config(
    project_id: str,
    project_name: str,
    config_path: Optional[str],
    profiling_data: list[dict],
    llm_result: dict,
    options: Any,
    existing_config: Optional[dict[str, Any]],
) -> dict[str, Any]:
    """
    @methoddesc 将 LLM 输出、画像数据和现有配置整合为最终的项目配置

    处理流程：
    1. 如需保留现有配置，先加载已有内容
    2. 根据选项生成/合并 schema、constraint、regex_node
    3. 构建标准 V2 清单文件
    4. 生成 YAML 预览

    参数:
        project_id: 项目唯一标识
        project_name: 项目显示名称
        config_path: 配置根目录（用于计算相对路径）
        profiling_data: 数据画像结果
        llm_result: LLM 返回的解析结果
        options: 生成选项
        existing_config: 现有配置（keep_existing 时使用）

    返回:
        包含 manifest、schemas、constraints、regex_nodes 等的字典
    """
    # 初始化结果容器
    schemas: dict[str, Any] = {}
    constraints: dict[str, Any] = {}
    regex_nodes: dict[str, Any] = {}
    warnings: list[str] = []

    # 如果有现有配置且 keep_existing，先加载现有内容
    if options.keep_existing and existing_config:
        schemas.update(existing_config.get("schemas", {}))
        constraints.update(existing_config.get("constraints", {}))
        regex_nodes.update(existing_config.get("regex_nodes", {}))

    # 构建 profiling_data 的 path -> table_name 映射，用于 source 配置
    path_to_profile = {item["path"]: item for item in profiling_data}

    def _make_relative_path(abs_path: str) -> str:
        """将绝对路径转为相对于项目根目录的路径。

        统一使用正斜杠，确保跨平台兼容性。
        """
        if config_path:
            try:
                return make_relative(config_path, abs_path)
            except ValueError:
                pass
        return normalize_to_posix(os.path.basename(abs_path))

    def _sanitize_id(name: str) -> str:
        """将名称转为合法的 id（小写，替换特殊字符为下划线）。"""
        return re.sub(r"[^a-z0-9_]", "_", name.lower()).strip("_")

    def _generate_semantic_constraint_id(table_id: str, column_ref: str, ctype: str, existing_ids: set) -> str:
        """生成语义化约束 ID，如遇冲突则自动添加序号后缀。

        格式: {table_id}_{column_ref}_{ctype} 或 {table_id}_{column_ref}_{ctype}_2
        """
        base = f"{_sanitize_id(table_id)}_{_sanitize_id(column_ref)}_{_sanitize_id(ctype)}"
        if base not in existing_ids:
            return base
        for i in range(2, 1000):
            candidate = f"{base}_{i}"
            if candidate not in existing_ids:
                return candidate
        return base

    def _normalize_constraint(cdef: dict, schema_id: str, existing_ids: set) -> Optional[dict]:
        """将 LLM 输出的约束（简化或 V2 格式）统一转换为 V2 标准格式。

        支持两种输入：
        - 已有 refs 字段的 V2 格式：做基本校验和补充
        - 简化格式：自动构建 refs 和 params
        """
        if not isinstance(cdef, dict):
            return None

        # 检测是否已经是 V2 格式（有 refs 字段）
        if "refs" in cdef and isinstance(cdef.get("refs"), dict):
            # 已经是 V2 格式，做基本校验和补充
            cid = cdef.get("id") or _generate_semantic_constraint_id(
                cdef["refs"].get("table_id", schema_id),
                cdef["refs"].get("column_id") or cdef["refs"].get("column_ids", ["unknown"])[0],
                cdef.get("type", "unknown"),
                existing_ids,
            )
            existing_ids.add(cid)
            return {
                "version": 2,
                "id": cid,
                "type": cdef.get("type", "NotNull"),
                "enabled": cdef.get("enabled", True),
                "description": cdef.get("description", ""),
                "refs": cdef["refs"],
                "params": cdef.get("params", {}),
            }

        # 简化格式转换
        ctype = cdef.get("type", "")
        if not ctype:
            return None

        # 统一类型名首字母大写
        ctype_normalized = ctype[0].upper() + ctype[1:].lower() if ctype else "NotNull"

        table_id = cdef.get("table_id", schema_id)
        column_id = cdef.get("column_id", "")
        column_ids = cdef.get("column_ids", [column_id] if column_id else [])

        # 构建 refs
        refs: dict[str, Any] = {"table_id": table_id}
        if ctype_normalized == "Unique":
            refs["column_ids"] = column_ids if column_ids else [column_id]
        elif ctype_normalized == "ForeignKey":
            refs["from_table_id"] = cdef.get("from_table_id", table_id)
            refs["from_column_id"] = cdef.get("from_column_id", column_id)
            refs["to_table_id"] = cdef.get("to_table_id", "")
            refs["to_column_id"] = cdef.get("to_column_id", "")
        elif ctype_normalized == "Conditional":
            refs["table_id"] = table_id
            refs["then_column_id"] = cdef.get("then_column_id", column_id)
            refs["if_conditions"] = cdef.get("if_conditions", [])
            refs["if_logic"] = cdef.get("if_logic", "and")
        else:
            refs["column_id"] = column_id

        # 构建 params
        params: dict[str, Any] = {}
        if ctype_normalized == "AllowedValues":
            params["allowed_values"] = cdef.get("allowed_values", [])
        elif ctype_normalized == "Range":
            params["min"] = cdef.get("min")
            params["max"] = cdef.get("max")
        elif ctype_normalized == "Conditional":
            params["then_value"] = cdef.get("then_value")
        elif ctype_normalized == "Scripted":
            params["expression"] = cdef.get("expression", "")

        cid = _generate_semantic_constraint_id(table_id, column_id or column_ids[0], ctype_normalized, existing_ids)
        existing_ids.add(cid)

        return {
            "version": 2,
            "id": cid,
            "type": ctype_normalized,
            "enabled": True,
            "description": cdef.get("description", ""),
            "refs": refs,
            "params": params,
        }

    def _normalize_regex_node(rdef: dict, existing_ids: set) -> Optional[dict]:
        """将 LLM 输出的正则节点标准化为 V2 格式。

        如果缺少 ID，则根据名称自动生成；如遇 ID 冲突则添加序号后缀。
        """
        if not isinstance(rdef, dict):
            return None
        rid = rdef.get("id")
        if not rid:
            rid = f"regex_{_sanitize_id(rdef.get('name', 'unnamed'))}"
        if rid in existing_ids:
            for i in range(2, 1000):
                candidate = f"{rid}_{i}"
                if candidate not in existing_ids:
                    rid = candidate
                    break
        existing_ids.add(rid)
        return {
            "version": 2,
            "id": rid,
            "name": rdef.get("name", rid),
            "description": rdef.get("description", ""),
            "pattern": rdef.get("pattern", ""),
            "match_mode": rdef.get("match_mode", "full"),
            "case_sensitive": rdef.get("case_sensitive", False),
            "flags": rdef.get("flags", ""),
            "enabled": rdef.get("enabled", True),
            "parameters": [],
            "rules": [],
            "source_ref": rdef.get("source_ref", {}),
        }

    # 处理 Schema
    if options.generate_schemas:
        for schema_def in llm_result.get("schemas", []):
            if not isinstance(schema_def, dict):
                continue
            schema_id = schema_def.get("id")
            if not schema_id:
                continue

            # 补充 source 配置
            profile = path_to_profile.get(schema_def.get("_source_path", ""))
            if not profile:
                # 尝试通过 table_name 匹配
                for p in profiling_data:
                    if p["table_name"] == schema_def.get("name", schema_id):
                        profile = p
                        break

            source: dict[str, Any] = {"mode": "relative_file", "path": "", "header_row": 0}
            if profile:
                source["path"] = _make_relative_path(profile["path"])
                if profile.get("sheet_name"):
                    source["sheet"] = profile["sheet_name"]
                # 根据文件类型补充 options
                ext = os.path.splitext(profile["path"])[1].lower()
                if ext == ".csv":
                    source["options"] = {"delimiter": ",", "encoding": "utf-8"}
                elif ext in [".xlsx", ".xls"]:
                    source["options"] = {"engine": "openpyxl"}
                elif ext in [".json", ".jsonl"]:
                    source["options"] = {"format": "auto"}

            # 构建标准 schema 格式
            schema_doc = {
                "version": 2,
                "id": schema_id,
                "name": schema_def.get("name", schema_id),
                "source": schema_def.get("source", source),
                "columns": schema_def.get("columns", []),
                "constraints": [],
            }

            # 处理内联约束（schema 级别的 constraints）
            for cdef in schema_def.get("constraints", []):
                if isinstance(cdef, dict):
                    schema_doc["constraints"].append(cdef)

            schemas[schema_id] = schema_doc

    # 处理 Constraints（独立约束文件）
    if options.generate_constraints:
        constraint_ids = set(constraints.keys())
        for cdef in llm_result.get("constraints", []):
            normalized = _normalize_constraint(cdef, "", constraint_ids)
            if normalized:
                constraints[normalized["id"]] = normalized
            else:
                warnings.append(f"无法解析约束: {cdef}")

    # 处理 Regex Nodes
    if options.generate_regex_nodes:
        regex_ids = set(regex_nodes.keys())
        for rdef in llm_result.get("regex_nodes", []):
            normalized = _normalize_regex_node(rdef, regex_ids)
            if normalized:
                regex_nodes[normalized["id"]] = normalized

    # 构建 Manifest
    manifest = {"version": 2, "project": {"id": project_id, "name": project_name}}
    manifest["schemas"] = [{"id": sid, "path": f"schemas/{sid}.schema.yaml"} for sid in schemas]
    manifest["constraints"] = [{"id": cid, "path": f"constraints/{cid}.constraint.yaml"} for cid in constraints]
    manifest["regex_nodes"] = [{"id": rid, "path": f"regex/{rid}.regex.yaml"} for rid in regex_nodes]

    # 生成 YAML 预览
    preview = {"manifest": manifest, "schemas": schemas, "constraints": constraints, "regex_nodes": regex_nodes}
    yaml_preview = yaml.safe_dump(preview, sort_keys=False, allow_unicode=True)

    return {
        "success": True,
        "yaml_preview": yaml_preview,
        "manifest": manifest,
        "schemas": schemas,
        "constraints": constraints,
        "regex_nodes": regex_nodes,
        "warnings": warnings,
    }
