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


class CLIError(Exception):
    """CLI 基础异常类。"""

    def __init__(self, message: str, exit_code: int = 1):
        super().__init__(message)
        self.message = message
        self.exit_code = exit_code


class ProjectNotFoundError(CLIError):
    """项目目录未找到异常。"""

    def __init__(self, path: str):
        super().__init__(f"项目目录未找到: {path}", exit_code=2)
        self.path = path


class InvalidProjectError(CLIError):
    """无效的项目目录异常。"""

    def __init__(self, path: str, reason: str):
        super().__init__(f"无效的项目目录: {path}, 原因: {reason}", exit_code=3)
        self.path = path
        self.reason = reason


class NoProjectOpenError(CLIError):
    """未打开项目异常。"""

    def __init__(self):
        super().__init__("未打开项目，请使用 'open <path>' 命令打开项目", exit_code=4)


class CommandNotFoundError(CLIError):
    """命令未找到异常。"""

    def __init__(self, command: str):
        super().__init__(f"命令未找到: {command}", exit_code=5)
        self.command = command


class ValidationError(CLIError):
    """验证执行异常。"""

    def __init__(self, message: str):
        super().__init__(f"验证执行失败: {message}", exit_code=6)


class ConfigError(CLIError):
    """配置文件操作异常。"""

    def __init__(self, message: str):
        super().__init__(f"配置文件操作失败: {message}", exit_code=7)


class EditorError(CLIError):
    """编辑器调用异常。"""

    def __init__(self, message: str):
        super().__init__(f"编辑器调用失败: {message}", exit_code=8)
