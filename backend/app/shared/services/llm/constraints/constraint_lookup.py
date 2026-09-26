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
"""@fileoverview 约束 ID 生成与约束文件定位模块

功能概述:
- 独立约束缺省 ID 生成：类型前缀 + UUID v4（防派生坍缩碰撞，保留类型可读性）
- LLM 显式 constraintId 的文件名安全清洗（白名单字符集 + 穿越拒绝）
- 按显式 ID 定位约束文件（内容 id 或文件名 stem）
- 按语义引用（表 + 列 + 类型）在磁盘搜索约束文件——对存量语义 ID 文件
  （如 range_xxx_col）与新 UUID 文件同样适用，删除/UPDATE/信封兜底共用

设计背景:
- 旧的 {类型}_{表缩写}_{列缩写} 派生 ID 会坍缩碰撞（全角括号列名清洗后都是 col），
  同表同类型两条约束派生出相同 ID 导致第二条被误判"已存在"；删除与信封链路
  依赖"重新派生"还原 ID，表/列改名后必然对不上。UUID 化后派生碰撞面消失，
  重复防护与定位改走磁盘内容的语义匹配。
"""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from typing import Any

import yaml

from app.shared.services.llm.constraints.constraint_builder import CONSTRAINT_TYPE_MAP
from app.shared.services.llm.schema_resolver import _resolve_id_from_name

logger = logging.getLogger(__name__)

_CONSTRAINT_SUFFIX = ".constraint.yaml"


def default_constraint_id(std_type: str) -> str:
    """生成缺省约束 ID：{类型小写}_{UUID v4}。

    保留类型前缀是为了下游（E2E ai-fake-provider 等）按前缀定位约束文件；
    碰撞防护由 UUID v4 尾部保证（派生坍缩不再可能产出相同 ID）。
    """
    return f"{std_type.lower()}_{uuid.uuid4()}"


def sanitize_constraint_id(raw: Any) -> str:
    """清洗 LLM 显式给出的约束 ID 为文件名安全形式。

    空值/缺省返回空串（表示未提供，调用方回退自动生成）；含路径分隔符、
    空段或清洗后为空的一律抛 ValueError（非法输入宁可失败不可静默改写）。
    """
    text = str(raw if raw is not None else "").strip()
    if not text:
        return ""
    if "/" in text or "\\" in text or ".." in text:
        raise ValueError(f"非法的约束 ID（不允许路径分隔符或 ..）: {text!r}")
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "_", text).strip("_")
    if not cleaned:
        raise ValueError(f"非法的约束 ID（清洗后为空）: {text!r}")
    return cleaned


def _read_constraint_yaml(path: Path) -> dict[str, Any] | None:
    """安全读取约束 YAML，失败返回 None（坏文件不阻断扫描）。"""
    try:
        if not path.exists():
            return None
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        logger.warning(f"[constraint_lookup] 读取约束文件失败 {path}: {e}")
        return None


def _stem_id(path: Path) -> str:
    """从文件名剥 .constraint.yaml 后缀推导 id。"""
    name = path.name
    return name[: -len(_CONSTRAINT_SUFFIX)] if name.endswith(_CONSTRAINT_SUFFIX) else path.stem


def find_constraint_file_by_id(workspace_path: str, constraint_id: str) -> tuple[str, Path] | None:
    """按显式 ID 定位约束文件，返回 (真实 id, 文件路径)，找不到返回 None。

    匹配口径：文件内容 id 或文件名 stem 等于 constraint_id 即命中；
    真实 id 优先取内容 id（entityId ≡ 磁盘文件 id 契约）。
    """
    if not workspace_path or not constraint_id:
        return None
    constraints_dir = Path(workspace_path) / "constraints"
    if not constraints_dir.exists():
        return None
    for f in sorted(constraints_dir.glob(f"*{_CONSTRAINT_SUFFIX}")):
        data = _read_constraint_yaml(f)
        if data is None:
            continue
        fid = data.get("id")
        if str(fid if fid is not None else "") == constraint_id or _stem_id(f) == constraint_id:
            return (str(fid) if fid not in (None, "") else _stem_id(f)), f
    return None


def _table_ref_of(data: dict[str, Any]) -> str:
    """提取约束文件 refs 里的表引用（table_id / from_table_id）。"""
    refs = data.get("refs") or {}
    if not isinstance(refs, dict):
        return ""
    for key in ("table_id", "from_table_id"):
        value = refs.get(key)
        if value:
            return str(value)
    return ""


def _column_refs_of(data: dict[str, Any]) -> list[str]:
    """提取约束文件 refs 里的列引用集合（多列 Unique 用 column_ids 列表）。"""
    refs = data.get("refs") or {}
    if not isinstance(refs, dict):
        return []
    multi = refs.get("column_ids")
    if isinstance(multi, list) and multi:
        return [str(c) for c in multi]
    for key in ("column_id", "then_column_id", "from_column_id"):
        value = refs.get(key)
        if value:
            return [str(value)]
    return []


def find_constraint_file_by_semantics(
    workspace_path: str,
    std_type: str,
    table_name: str = "",
    target_node_id: str = "",
    target_column: str = "",
    target_column_id: str = "",
    target_columns: list[str] | None = None,
) -> tuple[str, Path] | None:
    """按语义引用（表 + 列 + 类型）在磁盘搜索约束文件。

    匹配口径与写盘侧 `_build_constraint_refs` 对齐：名称先经 `_resolve_id_from_name`
    解析为表/列 ID，候选集同时包含原始名称与解析出的 ID（写盘未解析出 ID 的
    历史文件按名称命中；refs 缺表/列引用时视为通配，避免误判不重复）。
    多列联合唯一（target_columns 携带 >=2 列）按列集合整体相等匹配。

    返回 (真实 id, 文件路径)，找不到返回 None。对存量语义 ID 文件与新 UUID
    文件同样适用（loader 对 id 形状无假设，匹配只看内容）。
    """
    if not workspace_path or not std_type:
        return None

    resolved_table_id: str | None = None
    resolved_column_id: str | None = None
    if table_name:
        resolved_table_id, resolved_column_id = _resolve_id_from_name(
            workspace_path, table_name, target_column or target_column_id or None
        )
    table_candidates = {str(x) for x in (target_node_id, table_name, resolved_table_id) if x}
    if not table_candidates:
        return None
    column_candidates = {str(x) for x in (target_column_id, target_column, resolved_column_id) if x}

    multi_columns: set[str] = set()
    if isinstance(target_columns, list) and len(target_columns) >= 2:
        for raw in target_columns:
            cid = str(raw)
            if table_name:
                _, fallback_cid = _resolve_id_from_name(workspace_path, table_name, cid)
                if fallback_cid:
                    cid = fallback_cid
            multi_columns.add(cid)

    constraints_dir = Path(workspace_path) / "constraints"
    if not constraints_dir.exists():
        return None

    for f in sorted(constraints_dir.glob(f"*{_CONSTRAINT_SUFFIX}")):
        data = _read_constraint_yaml(f)
        if data is None:
            continue
        raw_type = data.get("type") or ""
        if CONSTRAINT_TYPE_MAP.get(raw_type, raw_type) != std_type:
            continue
        file_table = _table_ref_of(data)
        file_columns = _column_refs_of(data)
        if not file_table and not file_columns:
            # 完全无引用信息的文件无法印证任何语义引用（结构异常的极简文件），
            # 不作为命中——否则任意同类型 ADD 都会被它挡下
            continue
        if file_table and file_table not in table_candidates:
            continue
        if multi_columns:
            # 多列联合唯一：列集合整体相等才命中（列集合不同的 Unique 是不同约束）
            if set(file_columns) != multi_columns:
                continue
        elif column_candidates and file_columns:
            # 单列：任一候选命中；refs 缺列引用（历史未解析出 ID 的文件）视为通配
            if not (set(file_columns) & column_candidates):
                continue
        fid = data.get("id")
        return (str(fid) if fid not in (None, "") else _stem_id(f)), f
    return None
