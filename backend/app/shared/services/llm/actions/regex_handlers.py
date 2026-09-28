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
"""@fileoverview Regex 动作处理器模块

功能概述:
- 处理 AI 生成的 Regex CRUD 动作（ADD_REGEX / UPDATE_REGEX / DELETE_REGEX）
- 通过 core 层 writer 持久化 Regex YAML 文件
- 同步更新 project.precis.yaml 中的 RegexRef

架构设计:
- 复用 core/project/regex/writer.py 的 save_regex_node()
- 复用 core/project/manifest/writer.py 的 ensure_regex_ref() / save_manifest()
- 使用 RegexNodeFile Pydantic 模型确保类型安全
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import yaml

from app.shared.core.project.manifest.reader import load_manifest
from app.shared.core.project.manifest.types import ProjectManifest
from app.shared.core.project.manifest.writer import ensure_regex_ref, save_manifest
from app.shared.core.project.regex.types import RegexNodeFile, RegexSourceRef
from app.shared.core.project.regex.writer import save_regex_node
from app.shared.core.project.scaffold import ensure_manifest_exists
from app.shared.services.llm.actions.schema_handlers import _file_exists_failure_message
from app.shared.services.llm.yaml_io import FileLock, atomic_write_yaml, read_entity_id

logger = logging.getLogger(__name__)

VALID_MATCH_MODES = {"full", "partial", "extract"}


def _sanitize_resource_id(resource_id: str) -> str:
    cleaned = os.path.basename(resource_id)
    if "/" in resource_id or "\\" in resource_id or ".." in resource_id:
        raise ValueError(f"非法的资源 ID: {resource_id!r}")
    return cleaned


def process_regex_action(action: dict[str, Any], workspace_path: str, canvas_enabled: bool = True) -> dict[str, Any]:
    """
    @methoddesc 处理 Regex 动作

    根据 actionType 分发到对应的处理函数。

    参数:
        action: 动作字典，包含 actionType 和 regexSpec
        workspace_path: 项目工作区路径
        canvas_enabled: 当前环境是否有画布。无画布（CLI 等）时"文件已存在"
            错误文案引导 UPDATE_* 路径，不出现 ADD_TO_CANVAS/画布字样

    返回:
        处理结果字典 {"success": bool, "message": str}
    """
    action_type = action.get("actionType", "")
    spec = action.get("regexSpec", {})

    if action_type == "ADD_REGEX":
        return _add_regex(spec, workspace_path, canvas_enabled=canvas_enabled)
    elif action_type == "UPDATE_REGEX":
        return _update_regex(spec, workspace_path, canvas_enabled=canvas_enabled)
    elif action_type == "DELETE_REGEX":
        return _delete_regex(spec, workspace_path)
    else:
        return {"success": False, "message": f"未知的 Regex 动作类型: {action_type}"}


def _add_regex(spec: dict[str, Any], workspace_path: str, canvas_enabled: bool = True) -> dict[str, Any]:
    """创建新的 Regex YAML 文件（遇未登记的孤儿文件转为收养登记）"""
    regex_name = spec.get("name", "")
    regex_id = spec.get("regexId") or spec.get("id") or regex_name
    try:
        regex_id = _sanitize_resource_id(regex_id)
    except ValueError:
        return {"success": False, "message": f"非法的 Regex ID: {regex_id}"}
    pattern = spec.get("pattern", "")
    match_mode = spec.get("matchMode", "full")
    case_sensitive = spec.get("caseSensitive", False)
    description = spec.get("description")
    target_node_id = spec.get("targetNodeId")
    target_column = spec.get("targetColumn")

    if not regex_name:
        return {"success": False, "message": "Regex 名称不能为空"}
    if not pattern:
        return {"success": False, "message": "Regex 模式不能为空"}

    if match_mode not in VALID_MATCH_MODES:
        match_mode = "full"

    workspace = Path(workspace_path)
    # V2 标准：regex 文件统一存放在 regex/ 目录（manifest 登记与全仓读取方均认此目录），
    # 旧版写入 regex_nodes/ 会导致 manifest 引用的路径与实际文件位置漂移
    regex_dir = workspace / "regex"
    regex_dir.mkdir(parents=True, exist_ok=True)

    regex_file = regex_dir / f"{regex_id}.regex.yaml"
    # 已存在检测同时覆盖新旧目录（历史版本曾写入 regex_nodes/），避免跨目录产生同 ID 重复文件
    located = regex_file if regex_file.exists() else _find_regex_file(workspace_path, regex_id)
    if located is not None:
        # (a) 已存在且已登记 manifest → 失败（文案按画布能力分流，见 Fix C）
        # (b) 已存在但未登记（孤儿文件）→ 不失败，收养登记进 manifest
        actual_id = read_entity_id(located, default=regex_id)
        rel_path = located.relative_to(workspace).as_posix()
        if _regex_registered_in_manifest(workspace_path, actual_id, rel_path):
            return {
                "success": False,
                "message": _file_exists_failure_message("Regex", "regex", located.name, canvas_enabled),
            }
        try:
            _ensure_manifest_regex_ref(workspace_path, actual_id, default_path=rel_path)
        except Exception as e:
            logger.error(f"[RegexHandler] 收养孤儿 regex 登记失败: {located} -> {e}")
            return {"success": False, "message": f"Regex 文件已存在但登记进项目清单失败: {e}"}
        logger.info(f"[RegexHandler] 收养孤儿 Regex: {actual_id}（{rel_path}）")
        return {"success": True, "message": f"{actual_id}（文件已存在，已登记进项目清单）", "resolved_id": actual_id}

    # 构建 source_ref
    source_ref = None
    if target_node_id and target_column:
        source_ref = RegexSourceRef(table_id=target_node_id, column_id=target_column)

    try:
        regex_node = RegexNodeFile(
            version=2,
            id=regex_id,
            name=regex_name,
            pattern=pattern,
            match_mode=match_mode,
            case_sensitive=case_sensitive,
            description=description,
            enabled=True,
            uses_pattern=None,
            flags="",
            input_from_node=None,
            input_column=None,
            source_ref=source_ref,
            source_column_name=target_column,
        )
        save_regex_node(regex_node, regex_file)
    except Exception as e:
        return {"success": False, "message": f"写入 Regex 文件失败: {e}"}

    # 更新 manifest —— §2.7: 登记失败时回滚删除已写文件（对齐 Schema 路径），
    # 否则磁盘留下孤儿 .regex.yaml：重启后不被加载、不报错、画布节点还在
    try:
        _ensure_manifest_regex_ref(workspace_path, regex_id)
    except Exception as e:
        Path(regex_file).unlink(missing_ok=True)
        return {"success": False, "message": f"更新 manifest 引用失败（已回滚 Regex 文件）: {e}"}

    logger.info(f"[RegexHandler] 创建 Regex: {regex_id}")
    return {"success": True, "message": regex_id}


def _update_regex(spec: dict[str, Any], workspace_path: str, canvas_enabled: bool = True) -> dict[str, Any]:
    """更新现有 Regex（成功写盘后确保已登记进 manifest，收养孤儿文件）

    canvas_enabled 仅为签名对齐透传（UPDATE 路径不产生"文件已存在"文案）。
    """
    _ = canvas_enabled
    regex_id = spec.get("regexId") or spec.get("id") or spec.get("name", "")
    try:
        regex_id = _sanitize_resource_id(regex_id)
    except ValueError:
        return {"success": False, "message": f"非法的 Regex ID: {regex_id}"}

    if not regex_id:
        return {"success": False, "message": "缺少 Regex ID"}

    regex_file = _find_regex_file(workspace_path, regex_id)
    if not regex_file:
        return {"success": False, "message": f"Regex 文件不存在: {regex_id}"}

    try:
        with FileLock(str(regex_file)):
            with open(regex_file, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}

            if spec.get("pattern"):
                data["pattern"] = spec["pattern"]
            if spec.get("name"):
                data["name"] = spec["name"]
            if spec.get("matchMode"):
                data["match_mode"] = spec["matchMode"]
            if "caseSensitive" in spec:
                data["case_sensitive"] = spec["caseSensitive"]
            if "description" in spec:
                data["description"] = spec["description"]
            if spec.get("targetNodeId") and spec.get("targetColumn"):
                data["source_ref"] = {"table_id": spec["targetNodeId"], "column_id": spec["targetColumn"]}
                data["source_column_name"] = spec["targetColumn"]

            # §2.10: UPDATE 显式整体替换语义（与 UPDATE_TRANSFORM/UPDATE_SCHEMA 同族对齐）
            atomic_write_yaml(regex_file, data, preserve_format=False)

    except Exception as e:
        return {"success": False, "message": f"更新 Regex 失败: {e}"}

    # 写盘成功后确保登记进 manifest（幂等，收养孤儿）：登记路径取实际落盘文件
    # （regex 文件可能在旧版 regex_nodes/ 目录），id 取文件真实 id
    resolved_id = read_entity_id(regex_file, default=regex_id)
    try:
        rel_path = regex_file.relative_to(Path(workspace_path)).as_posix()
        _ensure_manifest_regex_ref(workspace_path, resolved_id, default_path=rel_path)
    except Exception as e:
        logger.error(f"[RegexHandler] UPDATE_REGEX 登记 manifest 失败: {e}")
        return {"success": False, "message": f"更新成功但登记进项目清单失败（已回滚）: {e}"}

    logger.info(f"[RegexHandler] 更新 Regex: {regex_id}")
    return {"success": True, "message": regex_id, "resolved_id": resolved_id}


def _delete_regex(spec: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """删除 Regex 文件"""
    regex_id = spec.get("regexId") or spec.get("id") or spec.get("name", "")
    try:
        regex_id = _sanitize_resource_id(regex_id)
    except ValueError:
        return {"success": False, "message": f"非法的 Regex ID: {regex_id}"}

    if not regex_id:
        return {"success": False, "message": "缺少 Regex ID"}

    regex_file = _find_regex_file(workspace_path, regex_id)
    if not regex_file:
        return {"success": False, "message": f"Regex 文件不存在: {regex_id}"}

    # 删除前捕获文件真实 id（画布节点 id 是文件 id，删除后磁盘无据可查）
    resolved_id = read_entity_id(regex_file, default=regex_id)

    try:
        regex_file.unlink()
    except OSError as e:
        return {"success": False, "message": f"删除 Regex 文件失败: {e}"}

    _remove_manifest_regex_ref(workspace_path, regex_id)

    logger.info(f"[RegexHandler] 删除 Regex: {regex_id}")
    return {"success": True, "message": regex_id, "resolved_id": resolved_id}


def _find_regex_file(workspace_path: str, regex_id: str) -> Path | None:
    """在工作区中查找 regex 文件"""
    # 检查多个可能的目录名
    for dirname in ("regex_nodes", "regex"):
        regex_dir = Path(workspace_path) / dirname
        if not regex_dir.exists():
            continue
        # 按 ID 精确匹配
        for rf in regex_dir.glob("*.yaml"):
            try:
                with open(rf, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                if data.get("id") == regex_id or data.get("name") == regex_id:
                    return rf
            except Exception:
                continue
        # 按文件名匹配
        candidate = regex_dir / f"{regex_id}.regex.yaml"
        if candidate.exists():
            return candidate
        candidate = regex_dir / f"{regex_id}.yaml"
        if candidate.exists():
            return candidate

    return None


def _regex_already_listed(manifest: ProjectManifest, regex_id: str, rel_path: str | None) -> bool:
    """判断 regex 是否已在 manifest 中登记（按 id 与按归一化路径双重口径）。"""
    normalized = (rel_path or "").replace("\\", "/").lower()
    for ref in manifest.regex_nodes:
        if ref.id == regex_id:
            return True
        if normalized and (ref.path or "").replace("\\", "/").lower() == normalized:
            return True
    return False


def _regex_registered_in_manifest(workspace_path: str, regex_id: str, rel_path: str | None = None) -> bool:
    """读取 manifest 判断 regex 是否已登记（缺失/不可读按未登记处理）。"""
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return False
    try:
        manifest = load_manifest(manifest_path)
    except Exception as e:
        logger.warning(f"[RegexHandler] 读取 manifest 失败，按未登记处理: {e}")
        return False
    return _regex_already_listed(manifest, regex_id, rel_path)


def _ensure_manifest_regex_ref(workspace_path: str, regex_id: str, default_path: str | None = None) -> None:
    """确保 manifest 中包含指定 Regex 引用（幂等：已按 id 或路径登记则 no-op）。

    §2.7: 异常向上传播（不再吞掉只留 warning）——调用方据此回滚已写的 Regex 文件。
    manifest 缺失时先创建最小脚手架清单再登记（兜底防孤儿，见 schema_handlers 同名函数）。

    参数:
        workspace_path: 项目工作区路径
        regex_id: regex 的实体 id（须与文件内容 id 一致）
        default_path: 引用路径缺省值；登记孤儿文件时传实际落盘相对路径
            （如旧版 regex_nodes/ 目录下的文件）
    """
    manifest_path = ensure_manifest_exists(workspace_path)

    manifest = load_manifest(manifest_path)
    if _regex_already_listed(manifest, regex_id, default_path):
        return
    ensure_regex_ref(manifest, regex_id, default_path)
    save_manifest(manifest, manifest_path)


def _remove_manifest_regex_ref(workspace_path: str, regex_id: str) -> None:
    """从 manifest 中移除指定 Regex 引用"""
    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return

    try:
        manifest = load_manifest(manifest_path)
        manifest.regex_nodes = [r for r in manifest.regex_nodes if r.id != regex_id]
        save_manifest(manifest, manifest_path)
    except Exception as e:
        logger.warning(f"[RegexHandler] 更新 manifest 引用失败: {e}")
