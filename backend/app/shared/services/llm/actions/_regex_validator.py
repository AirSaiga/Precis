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
"""
@fileoverview Regex 动作验证器

验证 AI 生成 Regex 相关动作（ADD_REGEX/UPDATE_REGEX/DELETE_REGEX）
的名称、模式、匹配模式合法性。
"""

from __future__ import annotations

from typing import Any

from app.shared.services.llm.actions.validation_types import ValidationError


def validate_regex_action(action: dict[str, Any], index: int) -> list[ValidationError]:
    """验证 Regex 操作

    检查 regexSpec 中的名称、模式、匹配模式合法性。
    """
    errors = []
    action_type = action.get("actionType", "")
    spec = action.get("regexSpec", {})

    if action_type == "ADD_REGEX":
        name = spec.get("name", "")
        pattern = spec.get("pattern", "")
        if not name:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="missing_regex_name",
                    message="Regex 名称不能为空",
                )
            )
        if not pattern:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="missing_regex_pattern",
                    message="Regex 模式不能为空",
                )
            )

    match_mode = spec.get("matchMode")
    if match_mode and match_mode not in {"full", "partial", "extract"}:
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="invalid_match_mode",
                message=f"不支持的匹配模式: '{match_mode}'",
                suggestion="可选: full, partial, extract",
            )
        )

    if action_type in ("UPDATE_REGEX", "DELETE_REGEX"):
        regex_id = spec.get("regexId") or spec.get("id") or spec.get("name")
        if not regex_id:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="missing_regex_id",
                    message="更新/删除 Regex 需要指定 regexId 或 name",
                )
            )

    return errors
