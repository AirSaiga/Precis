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
@fileoverview 动作验证器数据类型与格式化工具

定义:
- ValidationError: 验证错误信息数据类
- ValidationResult: 验证结果聚合数据类
- format_validation_result: 将结果格式化为可读文本
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ValidationError:
    """验证错误信息

    Attributes:
        action_index: 动作在列表中的索引
        action_type: 动作类型
        error_type: 错误类型标识
        message: 错误描述
        suggestion: 修正建议（可选）
        auto_fixable: 是否可以自动修正
    """

    action_index: int
    action_type: str
    error_type: str
    message: str
    suggestion: str | None = None
    auto_fixable: bool = False


@dataclass
class ValidationResult:
    """验证结果

    Attributes:
        errors: 错误列表（阻止执行）
        warnings: 警告列表（不阻止执行）
        valid_actions: 有效的动作列表
        invalid_action_indices: 无效的动作索引集合
    """

    errors: list[ValidationError] = field(default_factory=list)
    warnings: list[ValidationError] = field(default_factory=list)
    valid_actions: list[dict[str, Any]] = field(default_factory=list)
    invalid_action_indices: set[int] = field(default_factory=set)

    @property
    def has_errors(self) -> bool:
        """是否有错误"""
        return len(self.errors) > 0

    @property
    def has_warnings(self) -> bool:
        """是否有警告"""
        return len(self.warnings) > 0

    @property
    def all_valid(self) -> bool:
        """是否全部有效"""
        return len(self.errors) == 0 and len(self.invalid_action_indices) == 0

    @property
    def partial_valid(self) -> bool:
        """是否部分有效（有错误但也有有效动作）"""
        return len(self.errors) > 0 and len(self.valid_actions) > 0


def action_display_name(action_type: str) -> str:
    """把动作类型枚举（ADD_SCHEMA 等）翻译成用户可读的中文名。

    派生规则：动词前缀 + registry 里的 category；特殊只读动作单独映射；
    未登记的枚举回退原文（新增动作漏配时不会显示空白）。
    """
    special = {"VALIDATE_PROJECT": "校验项目", "ADD_TO_CANVAS": "添加到画布"}
    if action_type in special:
        return special[action_type]
    verbs = {"ADD": "新增", "UPDATE": "修改", "DELETE": "删除"}
    categories = {
        "constraint": "约束",
        "schema": "表结构",
        "regex": "正则",
        "transform": "数据转换",
        "settings": "项目设置",
    }
    from app.shared.services.llm.actions.registry import get_action_def

    d = get_action_def(action_type)
    if d is not None:
        verb = verbs.get(action_type.split("_", 1)[0], "")
        category = categories.get(d.category)
        if verb and category:
            return f"{verb}{category}"
    return action_type


def format_validation_result(result: ValidationResult) -> str:
    """格式化验证结果为可读文本

    参数:
        result: 验证结果

    返回:
        格式化后的文本
    """
    lines = []

    if result.all_valid and not result.warnings:
        return "所有操作验证通过"

    if result.errors:
        lines.append(f"发现 {len(result.errors)} 个问题：")
        for error in result.errors:
            lines.append(f"\n  [{error.action_index + 1}] {action_display_name(error.action_type)}")
            lines.append(f"      问题: {error.message}")
            if error.suggestion:
                lines.append(f"      建议: {error.suggestion}")

    if result.warnings:
        lines.append(f"\n另有 {len(result.warnings)} 个提醒：")
        for warning in result.warnings:
            lines.append(f"  - {warning.message}")

    if result.partial_valid:
        lines.append(f"\n其中 {len(result.valid_actions)} 个操作有效，{len(result.invalid_action_indices)} 个操作无效")

    return "\n".join(lines)
