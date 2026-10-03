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
# backend/app/cli/shell/exceptions.py
"""
@fileoverview CLI Shell 自定义异常模块

功能概述:
- 定义 CLI 交互式界面中使用的自定义异常类型
- 为不同错误场景提供特定的退出码
- 所有异常继承自 CLIError 基类

架构设计:
- CLIError 作为基础异常，包含消息和退出码
- 派生异常覆盖特定场景：项目未找到、命令未找到、验证失败等
"""

from app.cli.i18n import tr


class CLIError(Exception):
    """CLI 基础异常类。"""

    def __init__(self, message: str, exit_code: int = 1):
        super().__init__(message)
        self.message = message
        self.exit_code = exit_code


class ProjectNotFoundError(CLIError):
    """项目目录未找到异常。"""

    def __init__(self, path: str):
        super().__init__(
            tr("Project directory not found: {path}", "项目目录未找到: {path}").format(path=path), exit_code=2
        )
        self.path = path


class InvalidProjectError(CLIError):
    """无效的项目目录异常。"""

    def __init__(self, path: str, reason: str):
        super().__init__(
            tr("Invalid project directory: {path}, reason: {reason}", "无效的项目目录: {path}, 原因: {reason}").format(
                path=path, reason=reason
            ),
            exit_code=3,
        )
        self.path = path
        self.reason = reason


class NoProjectOpenError(CLIError):
    """未打开项目异常。"""

    def __init__(self) -> None:
        super().__init__(
            tr("No project open, use 'open <path>' to open one", "未打开项目，请使用 'open <path>' 命令打开项目"),
            exit_code=4,
        )


class CommandNotFoundError(CLIError):
    """命令未找到异常。"""

    def __init__(self, command: str):
        super().__init__(
            tr("Command not found: {command}", "命令未找到: {command}").format(command=command), exit_code=5
        )
        self.command = command


class ValidationError(CLIError):
    """验证执行异常。"""

    def __init__(self, message: str):
        super().__init__(
            tr("Validation failed: {message}", "验证执行失败: {message}").format(message=message), exit_code=6
        )


class ConfigError(CLIError):
    """配置文件操作异常。"""

    def __init__(self, message: str):
        super().__init__(
            tr("Config file operation failed: {message}", "配置文件操作失败: {message}").format(message=message),
            exit_code=7,
        )


class EditorError(CLIError):
    """编辑器调用异常。"""

    def __init__(self, message: str):
        super().__init__(
            tr("Editor invocation failed: {message}", "编辑器调用失败: {message}").format(message=message), exit_code=8
        )
