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

from app.shared.services.llm.yaml_io import FileLock, atomic_write_yaml

logger = logging.getLogger(__name__)

VALID_SETTINGS_CATEGORIES = {"validation", "fileProcessing", "scriptSecurity"}

CATEGORY_TO_YAML_KEY = {
    "validation": "validation",
    "fileProcessing": "file_processing",
    "scriptSecurity": "script_security",
}

VALID_ERROR_HANDLING = {"stop", "continue", "report"}
VALID_ENCODINGS = {"utf-8", "gbk", "auto"}
VALID_ALLOW_EVAL = {False}
VALID_SANDBOX_MODES = {"strict", "normal"}


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
            if not isinstance(val, (int, float)) or val <= 0:
                errors.append("timeout_seconds 必须为正数")
        if "batch_max_files" in settings:
            val = settings["batch_max_files"]
            if not isinstance(val, int) or val <= 0:
                errors.append("batch_max_files 必须为正整数")

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
            if not isinstance(val, (int, float)) or val <= 0:
                errors.append("timeout_seconds 必须为正数")
        if "allow_eval" in settings:
            if settings["allow_eval"] not in VALID_ALLOW_EVAL:
                errors.append("allow_eval 不允许通过 AI 修改")
        if "sandbox_mode" in settings:
            if settings["sandbox_mode"] not in VALID_SANDBOX_MODES:
                errors.append(f"sandbox_mode 必须为: {', '.join(VALID_SANDBOX_MODES)}")

    return errors
