# backend/app/cli/shell/__init__.py
"""
@fileoverview CLI Shell 模块入口

功能概述:
- 聚合导出 CLI Shell 核心组件（异常、格式化器）
- 提供统一的模块外部接口
"""

from app.cli.shell.exceptions import (
    CLIError,
    CommandNotFoundError,
    ConfigError,
    EditorError,
    InvalidProjectError,
    NoProjectOpenError,
    ProjectNotFoundError,
    ValidationError,
)
from app.cli.shell.formatter import Colors, Formatter

__all__ = [
    "CLIError",
    "ProjectNotFoundError",
    "InvalidProjectError",
    "NoProjectOpenError",
    "CommandNotFoundError",
    "ValidationError",
    "ConfigError",
    "EditorError",
    "Formatter",
    "Colors",
]
