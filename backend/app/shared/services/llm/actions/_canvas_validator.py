"""
@fileoverview ADD_TO_CANVAS 动作验证器

验证 AI 生成 ADD_TO_CANVAS 动作的合法性：
- canvasSpec.resourceKind 必须是 schema/regex/constraint/transform 之一
- resourceId 或 resourceName 至少有一个
- 目标资源在项目配置中必须真实存在（避免把不存在的资源"显示"到画布）

与其它验证器不同：本验证器是纯读校验（ADD_TO_CANVAS 不写盘），
但仍接入预验证链以拦截"显示不存在的资源"这类语义错误，把错误回灌给 LLM 自我修正。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from app.shared.services.llm.actions.registry import CANVAS_RESOURCE_KINDS
from app.shared.services.llm.actions.validation_types import ValidationError

# 支持的资源类型从注册表派生（单一事实源，与前端 ProjectResourceKind 对齐）
VALID_CANVAS_RESOURCE_KINDS = CANVAS_RESOURCE_KINDS


def _list_existing_resource_ids(workspace_path: str, kind: str) -> set[str]:
    """扫描项目配置目录，返回指定 kind 的已存在资源 ID 集合。

    用于校验 ADD_TO_CANVAS 的目标资源是否真实存在。
    扫描逻辑与 get_project_overview / 各 handler 的文件定位保持一致。
    """
    root = Path(workspace_path)
    ids: set[str] = set()

    dir_map = {
        "schema": ("schemas", "*.schema.yaml"),
        "regex": ("regex", "*.regex.yaml"),
        "constraint": ("constraints", "*.constraint.yaml"),
        "transform": ("transforms", "*.transform.yaml"),
    }
    if kind not in dir_map:
        return ids

    subdir, pattern = dir_map[kind]
    target_dir = root / subdir
    if not target_dir.exists():
        return ids

    for f in target_dir.glob(pattern):
        try:
            with open(f, encoding="utf-8") as fh:
                data = yaml.safe_load(fh) or {}
            rid = data.get("id") or data.get("name")
            if rid:
                ids.add(str(rid))
                # 同时收录 name 作为兜底匹配键（resourceName 常用 name）
                name = data.get("name")
                if name and str(name) != str(rid):
                    ids.add(str(name))
        except Exception:
            continue

    return ids


def validate_canvas_action(action: dict[str, Any], index: int, workspace_path: str) -> list[ValidationError]:
    """验证 ADD_TO_CANVAS 操作

    检查 canvasSpec 的 resourceKind 合法性、resourceId/resourceName 存在性，
    以及目标资源在项目配置中是否真实存在。
    """
    errors: list[ValidationError] = []
    action_type = action.get("actionType", "")
    spec = action.get("canvasSpec", {})

    if not isinstance(spec, dict):
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="missing_canvas_spec",
                message="ADD_TO_CANVAS 需要 canvasSpec 字段",
            )
        )
        return errors

    kind = spec.get("resourceKind", "")
    resource_id = spec.get("resourceId", "")
    resource_name = spec.get("resourceName") or spec.get("name", "")

    # 1. resourceKind 必须合法
    if kind not in VALID_CANVAS_RESOURCE_KINDS:
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="invalid_resource_kind",
                message=f"不支持的资源类型: '{kind}'",
                suggestion=f"可用类型: {', '.join(sorted(VALID_CANVAS_RESOURCE_KINDS))}",
            )
        )
        return errors

    # 2. resourceId 或 resourceName 至少有一个
    if not resource_id and not resource_name:
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="missing_resource_identifier",
                message="ADD_TO_CANVAS 需要指定 resourceId 或 resourceName",
                suggestion="可用 read_project 查询资源 ID/名称",
            )
        )
        return errors

    # 3. 目标资源必须真实存在（避免"显示不存在的资源"）
    existing_ids = _list_existing_resource_ids(workspace_path, kind)
    target_keys = {str(resource_id), str(resource_name)} - {""}
    if existing_ids and not (target_keys & existing_ids):
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="resource_not_found",
                message=f"资源不存在: {kind} '{resource_id or resource_name}'",
                suggestion="该资源未在项目配置中找到，请先创建（如用 ADD_SCHEMA）或检查名称拼写",
            )
        )

    return errors
