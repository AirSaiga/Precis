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
"""@fileoverview 项目设置动作处理器模块

功能概述:
- 处理 AI 生成的 UPDATE_SETTINGS 动作
- 修改 project.precis.yaml 中的 settings 段
- 支持三类设置：validation / file_processing / script_security

架构设计:
- 直接读写 project.precis.yaml 的 settings 字段
- 使用 atomic_write_yaml 保证文件写入安全
- 校验字段合法性
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ValidationError

from app.shared.core.project.manifest.types_parts.settings_file_processing import FileProcessingSettings
from app.shared.core.project.manifest.types_parts.settings_script_security import ScriptSecuritySettings
from app.shared.core.project.manifest.types_parts.settings_validation import ValidationSettings
from app.shared.services.llm.yaml_io import FileLock, atomic_write_yaml

logger = logging.getLogger(__name__)

# 设置分类白名单从注册表派生（单一事实源）
from app.shared.services.llm.actions.registry import SETTINGS_CATEGORIES as VALID_SETTINGS_CATEGORIES

CATEGORY_TO_YAML_KEY = {
    "validation": "validation",
    "fileProcessing": "file_processing",
    "scriptSecurity": "script_security",
}

# 分类 → manifest 设置模型：值域/类型的单一事实源是模型 Field 约束（C3 修复），
# handler 校验与落盘前模型重建均以此为准，避免两套事实打架写坏 manifest。
CATEGORY_TO_SETTINGS_MODEL: dict[str, type[BaseModel]] = {
    "validation": ValidationSettings,
    "fileProcessing": FileProcessingSettings,
    "scriptSecurity": ScriptSecuritySettings,
}

VALID_ERROR_HANDLING = {"stop", "continue", "report"}
VALID_ENCODINGS = {"utf-8", "gbk", "auto"}
VALID_ALLOW_EVAL = {False}


def process_settings_action(action: dict[str, Any], workspace_path: str) -> dict[str, Any]:
    """
    @methoddesc 处理 UPDATE_SETTINGS 动作

    根据 settingsSpec 中的 category 和 settings 更新项目配置。

    参数:
        action: 动作字典，包含 actionType 和 settingsSpec
        workspace_path: 项目工作区路径

    返回:
        处理结果字典 {"success": bool, "message": str}
    """
    spec = action.get("settingsSpec", {})
    category = spec.get("category", "")
    settings = spec.get("settings", {})

    if not category:
        return {"success": False, "message": "缺少 settings category"}
    if category not in VALID_SETTINGS_CATEGORIES:
        return {"success": False, "message": f"未知的 settings category: {category}"}
    if not settings:
        return {"success": False, "message": "settings 不能为空"}

    # 校验 settings 合法性
    validation_errors = _validate_settings(category, settings)
    if validation_errors:
        return {"success": False, "message": f"设置校验失败: {'; '.join(validation_errors)}"}

    manifest_path = Path(workspace_path) / "project.precis.yaml"
    if not manifest_path.exists():
        return {"success": False, "message": "project.precis.yaml 不存在"}

    yaml_key = CATEGORY_TO_YAML_KEY[category]

    try:
        with FileLock(str(manifest_path)):
            with open(manifest_path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}

            # 确保 settings 段存在
            if "settings" not in data:
                data["settings"] = {}

            if yaml_key not in data["settings"]:
                data["settings"][yaml_key] = {}

            # 合并设置（不覆盖未指定的字段）
            data["settings"][yaml_key].update(settings)

            # C3: 落盘前经模型重建校验——非法值(如 sandbox_mode="strict"、
            # timeout_seconds>300)直接落盘会导致下次加载 model_validate 422、
            # 项目无法打开。模型是值域的单一事实源，merge 后的完整段必须能过模型。
            model = CATEGORY_TO_SETTINGS_MODEL[category]
            try:
                model.model_validate(data["settings"][yaml_key])
            except ValidationError as e:
                return {"success": False, "message": f"设置校验失败: {e}"}

            atomic_write_yaml(manifest_path, data)

    except Exception as e:
        return {"success": False, "message": f"更新项目设置失败: {e}"}

    logger.info(f"[SettingsHandler] 更新设置: {category}")
    return {"success": True, "message": f"settings.{category}"}


def _validate_settings(category: str, settings: dict[str, Any]) -> list[str]:
    """校验设置字段的合法性"""
    errors = []

    if category == "validation":
        if "error_handling" in settings:
            if settings["error_handling"] not in VALID_ERROR_HANDLING:
                errors.append(f"error_handling 必须为: {', '.join(VALID_ERROR_HANDLING)}")
        if "timeout_seconds" in settings:
            val = settings["timeout_seconds"]
            # 对齐 ValidationSettings: int 型, 1-300 (bool 是 int 子类,须显式排除)
            if isinstance(val, bool) or not isinstance(val, int) or not 1 <= val <= 300:
                errors.append("timeout_seconds 必须为 1-300 的整数")
        if "batch_max_files" in settings:
            val = settings["batch_max_files"]
            # 对齐 ValidationSettings: int 型, 1-1000
            if isinstance(val, bool) or not isinstance(val, int) or not 1 <= val <= 1000:
                errors.append("batch_max_files 必须为 1-1000 的整数")

    elif category == "fileProcessing":
        if "default_encoding" in settings:
            if settings["default_encoding"] not in VALID_ENCODINGS:
                errors.append(f"default_encoding 必须为: {', '.join(VALID_ENCODINGS)}")
        if "csv_delimiter" in settings:
            val = settings["csv_delimiter"]
            if not isinstance(val, str) or len(val) != 1:
                errors.append("csv_delimiter 必须为单字符")

    elif category == "scriptSecurity":
        if "timeout_seconds" in settings:
            val = settings["timeout_seconds"]
            # 对齐 ScriptSecuritySettings: int 型, 1-60
            if isinstance(val, bool) or not isinstance(val, int) or not 1 <= val <= 60:
                errors.append("timeout_seconds 必须为 1-60 的整数")
        if "allow_eval" in settings:
            if settings["allow_eval"] not in VALID_ALLOW_EVAL:
                errors.append("allow_eval 不允许通过 AI 修改")
        if "sandbox_mode" in settings:
            val = settings["sandbox_mode"]
            # 对齐 ScriptSecuritySettings.sandbox_mode: bool 型——
            # 旧白名单 {"strict","normal"} 与模型矛盾:唯一合法值 true 被拒、
            # 非法字符串被放行,落盘后下次加载 model_validate 直接 422。
            if not isinstance(val, bool):
                errors.append("sandbox_mode 必须为布尔值")

    return errors
