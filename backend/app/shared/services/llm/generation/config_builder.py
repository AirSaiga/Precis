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

from __future__ import annotations

import os
import re
from typing import Any

import yaml

from app.shared.core.utils.path_utils import make_relative, normalize_to_posix
from app.shared.services.llm.constraints.constraint_builder import CONSTRAINT_TYPE_MAP


def _column_reference_maps(schema_doc: dict[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    """构建 schema 的列引用双向解析表。

    返回 (id -> 列名, 列名/id -> id)。生成链路产出的列为扁平结构（无嵌套 children），
    故不做递归展开；列名冲突时保留首个。

    :param schema_doc: schema 文档字典（含 columns）
    :return: (id_to_name, ref_to_id)
    """
    id_to_name: dict[str, str] = {}
    ref_to_id: dict[str, str] = {}
    for col in schema_doc.get("columns", []) or []:
        if not isinstance(col, dict):
            continue
        cid = col.get("id")
        cname = col.get("name")
        if cid is not None and cname:
            id_to_name[str(cid)] = str(cname)
            ref_to_id.setdefault(str(cname), str(cid))
            # 列 id 本身也接受作为引用（LLM 习惯写 id 而非列名）
            ref_to_id.setdefault(str(cid), str(cid))
    return id_to_name, ref_to_id


def _resolve_column_ref(ref: Any, id_to_name: dict[str, str], ref_to_id: dict[str, str]) -> tuple[str, str] | None:
    """把列引用（列 id 或列名）解析为 (列名, 列 id)。

    内嵌约束的 column 字段由加载器按**列名**精确解析，而 LLM 习惯写列 id，
    因此统一在此归一。解析不到返回 None（调用方丢弃该约束并告警）。
    """
    key = str(ref or "")
    if not key:
        return None
    if key in id_to_name:
        return id_to_name[key], key
    if key in ref_to_id:
        return key, ref_to_id[key]
    return None


def _constraint_semantic_key(normalized: dict[str, Any]) -> tuple[str, Any, str] | None:
    """提取独立约束的语义去重键 (表, 列, 类型)；引用不全时返回 None（不参与去重）。"""
    ctype = normalized.get("type", "")
    refs = normalized.get("refs", {}) or {}
    table_id = refs.get("table_id") or refs.get("from_table_id") or ""
    if not table_id:
        return None
    if ctype == "ForeignKey":
        col_ref: Any = refs.get("from_column_id") or ""
    elif ctype == "Conditional":
        col_ref = refs.get("then_column_id") or ""
    elif ctype == "Unique":
        col_ref = tuple(sorted(refs.get("column_ids") or []))
    else:
        col_ref = refs.get("column_id") or ""
    if not col_ref:
        return None
    return (str(table_id), col_ref, str(ctype))


def _is_constraint_item_shape(cdef: dict[str, Any]) -> bool:
    """判断内嵌定义是否已是 ConstraintItem（内嵌目标）形态。

    判据：不含独立管线引用键（refs/column_id/column_ids/from_column_id），
    而以 column/columns/from_column 表达引用——refine 循环回流的上一轮配置
    即此形态，需先归一才能复用简化管线。
    """
    if "refs" in cdef or "column_id" in cdef or "column_ids" in cdef or "from_column_id" in cdef:
        return False
    return any(k in cdef for k in ("column", "columns", "from_column"))


def _constraint_item_to_simplified(item: dict[str, Any]) -> dict[str, Any]:
    """把 ConstraintItem 形态归一为简化管线输入（键名提升 + params 顶层化）。

    - column/columns/from_column/to_table/to_column → 管线识别的 *_id 键
    - Conditional 的 THEN/IF 引用（params 中，列 ID 语义）上提到顶层
    - 其余 params 键顶层化（allowed_values/min/max/expression/charset_mode/
      then_condition 等），供 _normalize_constraint 的简化分支读取；
      原始 params 仍保留在返回值的 params 键上，供调用方回填管线未消费的键
    """
    out = dict(item)
    if item.get("column") is not None:
        out["column_id"] = item["column"]
    if item.get("columns") is not None:
        out["column_ids"] = item["columns"]
    if item.get("from_table") is not None:
        out["from_table_id"] = item["from_table"]
    if item.get("from_column") is not None:
        out["from_column_id"] = item["from_column"]
    if item.get("to_table") is not None:
        out["to_table_id"] = item["to_table"]
    if item.get("to_column") is not None:
        out["to_column_id"] = item["to_column"]
    params = item.get("params") or {}
    if not isinstance(params, dict):
        params = {}
    for key, value in params.items():
        out.setdefault(str(key), value)
    if "then_column_id" in params:
        out.setdefault("then_column_id", params["then_column_id"])
    if "if_conditions" in params:
        out.setdefault("if_conditions", params["if_conditions"])
    if "if_logic" in params:
        out.setdefault("if_logic", params["if_logic"])
    return out


def build_config(
    project_id: str,
    project_name: str,
    config_path: str | None,
    profiling_data: list[dict],
    llm_result: dict,
    options: Any,
    existing_config: dict[str, Any] | None,
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

    def _find_existing_schema_id_by_source(src_path: str, sheet_name: str | None) -> str | None:
        """根据 source.path + source.sheet 查找已有 schema，复用其 ID。

        避免同一文件因 ID 计算方式不同而被识别为新增 schema。
        """
        for sid, sdoc in schemas.items():
            existing_src = sdoc.get("source", {})
            existing_path = existing_src.get("path", "")
            existing_sheet = existing_src.get("sheet")
            if existing_path == src_path and existing_sheet == sheet_name:
                return sid
        return None

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

    def _normalize_constraint(cdef: dict, schema_id: str, existing_ids: set) -> dict[str, Any] | None:
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
                # 显式空 column_ids 列表时 .get 的默认值不生效，需 or 兜底，否则 [0] 越界
                cdef["refs"].get("column_id") or (cdef["refs"].get("column_ids") or ["unknown"])[0],
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

        # 类型名标准化：大写别名表（NOT_NULL/DATE_LOGIC 等 + PascalCase 正名）优先，
        # 再兜底忽略大小写/下划线的紧凑匹配（notnull/date_logic/DAT ELOGIC 等变体）。
        # 旧实现 `ctype[0].upper()+ctype[1:].lower()` 会把 DateLogic 摧毁成 Datelogic、
        # notnull 摧毁成 Notnull（均为非法类型名，下游 ConstraintFile 校验必挂）
        ctype_normalized = CONSTRAINT_TYPE_MAP.get(ctype, ctype)
        if ctype_normalized == ctype and ctype:
            compact_map = {k.replace("_", "").lower(): v for k, v in CONSTRAINT_TYPE_MAP.items()}
            compact_map.update({v.lower(): v for v in CONSTRAINT_TYPE_MAP.values()})
            ctype_normalized = compact_map.get(ctype.lower().replace("_", ""), ctype)

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
            if cdef.get("boundary_mode") is not None:
                params["boundary_mode"] = cdef.get("boundary_mode")
        elif ctype_normalized == "Conditional":
            # then_condition 是运行时唯一消费的 THEN 侧参数（旧 then_value 无消费方，
            # 会致约束构造 TypeError 被 factory 丢弃——静默漏判）
            then = cdef.get("then_condition") or cdef.get("thenCondition")
            if then is not None:
                params["then_condition"] = then
        elif ctype_normalized == "Scripted":
            params["expression"] = cdef.get("expression", "")
        elif ctype_normalized == "Charset":
            mode = cdef.get("charset_mode") or cdef.get("charsetMode")
            if mode is not None:
                params["charset_mode"] = mode
        elif ctype_normalized == "DateLogic":
            # 参考值/计算参数逐键透传（仅写实际提供的键）
            for snake in (
                "logic_mode",
                "compare_op",
                "reference_date",
                "reference_column",
                "reference_date_end",
                "reference_column_end",
                "calculation_type",
                "target_value",
                "target_column",
            ):
                if cdef.get(snake) is not None:
                    params[snake] = cdef.get(snake)
        elif ctype_normalized == "Composite":
            if cdef.get("sub_constraints"):
                params["sub_constraints"] = cdef.get("sub_constraints")
                params["logic"] = cdef.get("logic", "all")

        # 表级约束（无 column_id/column_ids）时以 "unknown" 兜底参与 ID 生成，
        # 避免空列表 [0] 索引 IndexError 崩掉整个配置生成
        cid = _generate_semantic_constraint_id(
            table_id, column_id or (column_ids[0] if column_ids else "unknown"), ctype_normalized, existing_ids
        )
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

    def _normalize_regex_node(rdef: dict, existing_ids: set) -> dict[str, Any] | None:
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

    # 处理 Schema —— 使用 LLM 提供的语义化 ID
    llm_id_to_schema_id: dict[str, str] = {}  # LLM 返回的原始 ID -> 最终 ID 映射
    used_schema_ids: set[str] = set(schemas.keys())  # 已占用的 ID（含 keep_existing）
    # LLM 在 schema 内给出的原始内嵌约束延后统一规范化（见独立约束处理之后的内嵌阶段）
    raw_inline_by_schema: dict[str, list[dict[str, Any]]] = {}
    if options.generate_schemas:
        for schema_def in llm_result.get("schemas", []):
            if not isinstance(schema_def, dict):
                continue
            llm_schema_id = schema_def.get("id") or schema_def.get("name", "")
            if not llm_schema_id:
                continue

            # 补充 source 配置
            profile = path_to_profile.get(schema_def.get("_source_path", ""))
            if not profile:
                for p in profiling_data:
                    if p["table_name"] == schema_def.get("name", llm_schema_id):
                        profile = p
                        break

            source: dict[str, Any] = {"mode": "relative_file", "path": "", "header_row": 0}
            if profile:
                source["path"] = _make_relative_path(profile["path"])
                if profile.get("sheet_name"):
                    source["sheet"] = profile["sheet_name"]
                ext = os.path.splitext(profile["path"])[1].lower()
                if ext == ".csv":
                    source["options"] = {"delimiter": ",", "encoding": "utf-8"}
                elif ext in [".xlsx", ".xls"]:
                    source["options"] = {"engine": "openpyxl"}
                elif ext in [".json", ".jsonl"]:
                    source["options"] = {"format": "auto"}

            # 优先复用已有 schema 的 ID（按 source.path + sheet 匹配）
            src_path = source.get("path", "")
            sheet_name = source.get("sheet")
            existing_id = _find_existing_schema_id_by_source(src_path, sheet_name) if src_path else None
            if existing_id:
                proper_schema_id = existing_id
            else:
                # 使用 LLM 提供的语义化 ID，清洗并保证唯一
                proper_schema_id = _sanitize_id(llm_schema_id)
                base = proper_schema_id
                i = 2
                while proper_schema_id in used_schema_ids:
                    proper_schema_id = f"{base}_{i}"
                    i += 1
                used_schema_ids.add(proper_schema_id)

            llm_id_to_schema_id[llm_schema_id] = proper_schema_id

            # 构建标准 schema 格式（constraints 先占位，内嵌约束在全部 schema 的
            # ID 映射与列定义就绪后统一规范化，才能解析列引用/FK 目标表并跨形态去重）
            schema_doc = {
                "version": 2,
                "id": proper_schema_id,
                "name": schema_def.get("name", llm_schema_id),
                "source": schema_def.get("source", source),
                "columns": schema_def.get("columns", []),
                "constraints": [],
            }

            schemas[proper_schema_id] = schema_doc
            raw_inline_by_schema[proper_schema_id] = [
                cdef for cdef in schema_def.get("constraints", []) if isinstance(cdef, dict)
            ]

    def _remap_schema_refs(obj: Any) -> Any:
        """递归替换约束中的 table_id 为规范 Schema ID。"""
        if isinstance(obj, dict):
            remapped: dict[str, Any] = {}
            for k, v in obj.items():
                if (
                    k in ("table_id", "from_table_id", "to_table_id")
                    and isinstance(v, str)
                    and v in llm_id_to_schema_id
                ):
                    remapped[k] = llm_id_to_schema_id[v]
                else:
                    remapped[k] = _remap_schema_refs(v)
            return remapped
        if isinstance(obj, list):
            return [_remap_schema_refs(item) for item in obj]
        return obj

    # 先处理独立 Constraints，再统一做 ID 重映射
    if options.generate_constraints:
        constraint_ids = set(constraints.keys())
        for cdef in llm_result.get("constraints", []):
            # 将约束中的 table_id 从 LLM ID 替换为规范 ID
            cdef = _remap_schema_refs(cdef)
            normalized = _normalize_constraint(cdef, "", constraint_ids)
            if normalized:
                constraints[normalized["id"]] = normalized
            else:
                warnings.append(f"无法解析约束: {cdef}")

    # 语义键集合：用于内嵌/独立跨形态去重（同表同列同类型只保留一处，防止双重校验）。
    # 在独立约束收集完成后构建，天然覆盖 keep_existing 带入的既有独立约束。
    standalone_keys: set[tuple[str, Any, str]] = set()
    inline_seen_keys: set[tuple[str, Any, str]] = set()
    if options.generate_constraints:
        for norm in constraints.values():
            key = _constraint_semantic_key(norm)
            if key:
                standalone_keys.add(key)

        # ============ 内嵌约束规范化（内嵌优先约定的落地） ============
        # LLM 在 schema.constraints 里给出的内嵌定义统一转为 ConstraintItem 形态，
        # 消费约定对齐后端 embedded_constraints 加载器：
        # - column/columns/from_column/to_column 承载全限定列名（加载器按列名精确解析）
        # - FK 的 to_table 承载规范 Schema ID
        # - Conditional 的 THEN/IF 引用属列 ID 语义，保留在 params（加载器从 params 提取）
        # - Composite 不内嵌（与前端 embeddedSelector 规则一致），降级为独立约束
        for schema_id, raw_list in raw_inline_by_schema.items():
            schema_doc = schemas.get(schema_id)
            if not schema_doc:
                continue
            id_to_name, ref_to_id = _column_reference_maps(schema_doc)
            used_local_ids: set[str] = set()
            for cdef in raw_list:
                # refine 循环回流的内嵌约束已是 ConstraintItem 形态，先归一为管线输入
                if _is_constraint_item_shape(cdef):
                    cdef = _constraint_item_to_simplified(cdef)
                v2 = _normalize_constraint(_remap_schema_refs(cdef), str(schema_id), set())
                if not v2:
                    warnings.append(f"无法解析内嵌约束: {cdef}")
                    continue
                ctype = v2["type"]
                refs = v2.get("refs", {})
                params = dict(v2.get("params", {}) or {})
                # 保全管线未消费的原始 params 键（如 Charset 的 allowed_chars、Scripted 的 name）
                raw_params = cdef.get("params")
                if isinstance(raw_params, dict):
                    for pk, pv in raw_params.items():
                        params.setdefault(str(pk), pv)

                item: dict[str, Any] = {
                    "id": "",
                    "type": ctype,
                    "enabled": v2.get("enabled", True),
                    "params": params,
                }
                if v2.get("description"):
                    item["description"] = v2["description"]

                if ctype == "Composite":
                    # 组合约束不支持内嵌：转为独立约束（refs 形态），id 冲突自动加后缀
                    standalone = _normalize_constraint(cdef, str(schema_id), set(constraints.keys()))
                    if standalone:
                        constraints[standalone["id"]] = standalone
                        key = _constraint_semantic_key(standalone)
                        if key:
                            standalone_keys.add(key)
                        warnings.append(f"Composite 约束不支持内嵌，已转为独立约束: {standalone['id']}")
                    else:
                        warnings.append(f"无法解析内嵌组合约束: {cdef}")
                    continue

                if ctype == "ForeignKey":
                    from_resolved = _resolve_column_ref(refs.get("from_column_id"), id_to_name, ref_to_id)
                    if not from_resolved:
                        warnings.append(f"内嵌外键约束的源列无法解析: {refs.get('from_column_id')}")
                        continue
                    target_id = str(refs.get("to_table_id", ""))
                    target_doc = schemas.get(target_id)
                    if target_doc is None:
                        warnings.append(f"内嵌外键约束的目标表不存在: {target_id}")
                        continue
                    t_id_to_name, t_ref_to_id = _column_reference_maps(target_doc)
                    to_resolved = _resolve_column_ref(refs.get("to_column_id"), t_id_to_name, t_ref_to_id)
                    if not to_resolved:
                        warnings.append(f"内嵌外键约束的目标列无法解析: {refs.get('to_column_id')}")
                        continue
                    item["from_column"] = from_resolved[0]
                    item["to_table"] = target_id
                    item["to_column"] = to_resolved[0]
                    key_col: Any = from_resolved[1]
                elif ctype == "Conditional":
                    # THEN/IF 引用是列 ID 语义：从 refs 挪进 params（加载器从 params 提取）
                    for ref_key in ("then_column_id", "if_conditions", "if_logic"):
                        if ref_key in refs:
                            params[ref_key] = refs[ref_key]
                    if not params.get("then_column_id"):
                        warnings.append(f"内嵌条件约束缺少 then_column_id: {v2['id']}")
                        continue
                    key_col = str(params["then_column_id"])
                elif ctype == "Unique":
                    names: list[str] = []
                    resolved_ids: list[str] = []
                    all_resolved = True
                    for ref in refs.get("column_ids") or []:
                        resolved = _resolve_column_ref(ref, id_to_name, ref_to_id)
                        if not resolved:
                            warnings.append(f"内嵌唯一约束的列无法解析: {ref}")
                            all_resolved = False
                            break
                        names.append(resolved[0])
                        resolved_ids.append(resolved[1])
                    if not all_resolved:
                        continue
                    item["columns"] = names
                    key_col = tuple(sorted(resolved_ids))
                else:
                    resolved = _resolve_column_ref(refs.get("column_id"), id_to_name, ref_to_id)
                    if not resolved:
                        warnings.append(f"内嵌约束的列无法解析: {refs.get('column_id')}")
                        continue
                    item["column"] = resolved[0]
                    key_col = resolved[1]

                # 跨形态语义去重：独立或已见内嵌中存在同 (表, 列, 类型) 时丢弃本条
                dedup_key = (str(schema_id), key_col, ctype)
                if dedup_key in standalone_keys or dedup_key in inline_seen_keys:
                    warnings.append(f"忽略重复约束（同表同列同类型已存在）: {ctype} @ {schema_id}")
                    continue
                inline_seen_keys.add(dedup_key)

                # 表内唯一的局部 id：{列}_{类型}，冲突加序号（加载器会再拼表前缀保证全局唯一）
                col_label = "-".join(key_col) if isinstance(key_col, tuple) else str(key_col)
                base_local = _sanitize_id(f"{col_label}_{ctype}")
                local_id = base_local
                suffix = 2
                while local_id in used_local_ids:
                    local_id = f"{base_local}_{suffix}"
                    suffix += 1
                used_local_ids.add(local_id)
                item["id"] = local_id
                schema_doc["constraints"].append(item)

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
