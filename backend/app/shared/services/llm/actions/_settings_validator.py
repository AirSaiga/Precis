"""
@fileoverview Settings 动作验证器

验证 AI 生成 Settings 操作（UPDATE_SETTINGS）的 category 和 settings 合法性。
"""

from __future__ import annotations

from typing import Any

from app.shared.services.llm.actions.registry import SETTINGS_CATEGORIES
from app.shared.services.llm.actions.validation_types import ValidationError

# 设置分类白名单从注册表派生（单一事实源）
VALID_SETTINGS_CATEGORIES = SETTINGS_CATEGORIES


def validate_settings_action(action: dict[str, Any], index: int) -> list[ValidationError]:
    """验证 Settings 操作

    检查 settingsSpec 中的 category 和 settings 合法性。
    """
    errors = []
    action_type = action.get("actionType", "")
    spec = action.get("settingsSpec", {})

    category = spec.get("category", "")
    settings = spec.get("settings", {})

    if not category:
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="missing_settings_category",
                message="缺少 settings category",
                suggestion=f"可选: {', '.join(sorted(VALID_SETTINGS_CATEGORIES))}",
            )
        )
    elif category not in VALID_SETTINGS_CATEGORIES:
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="invalid_settings_category",
                message=f"未知的 settings category: '{category}'",
                suggestion=f"可选: {', '.join(sorted(VALID_SETTINGS_CATEGORIES))}",
            )
        )

    if not settings:
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="empty_settings",
                message="settings 不能为空",
            )
        )

    return errors
