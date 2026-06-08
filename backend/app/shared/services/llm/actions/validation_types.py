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


def format_validation_result(result: ValidationResult) -> str:
    """格式化验证结果为可读文本

    参数:
        result: 验证结果

    返回:
        格式化后的文本
    """
    lines = []

    if result.all_valid and not result.warnings:
        return "[OK] 所有操作验证通过"

    if result.errors:
        lines.append(f"[!] 发现 {len(result.errors)} 个问题:")
        for error in result.errors:
            lines.append(f"\n  [{error.action_index + 1}] {error.action_type}")
            lines.append(f"      错误: {error.message}")
            if error.suggestion:
                lines.append(f"      建议: {error.suggestion}")

    if result.warnings:
        lines.append(f"\n[!] {len(result.warnings)} 个警告:")
        for warning in result.warnings:
            lines.append(f"  - {warning.message}")

    if result.partial_valid:
        lines.append(
            f"\n[i] {len(result.valid_actions)} 个操作有效，"
            f"{len(result.invalid_action_indices)} 个操作无效"
        )

    return "\n".join(lines)
