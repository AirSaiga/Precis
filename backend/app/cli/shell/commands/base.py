# backend/app/cli/shell/commands/base.py
"""
@fileoverview CLI Shell 命令基类模块

功能概述:
- 定义所有 Shell 命令的抽象基类 Command，统一命令的名称、别名、描述与执行接口
- 提供命令执行结果数据类 CommandResult，支持成功、错误、退出三种结果状态
- 提供命令执行上下文 CommandContext 与项目上下文 ProjectContext，用于保存运行时状态

架构设计:
- Command 抽象基类规范命令的基本属性与接口：
  - name: 命令名称
  - aliases: 命令别名列表
  - description: 命令描述（抽象属性，子类必须实现）
  - usage: 命令用法示例
  - help_text: 自动生成完整帮助文本
  - execute(): 执行命令的核心方法（抽象方法，子类必须实现）
  - add_subcommand()/get_subcommand(): 支持子命令注册与查找
- CommandResult 使用静态工厂方法 ok()/error()/exit() 快速创建结果对象
- ProjectContext 继承 CommandContext，额外维护当前打开的项目路径和配置
  - 通过 @property.setter 自动同步到父类的状态字典，确保数据一致性

输入示例:
    result = CommandResult.ok("操作成功", data={"key": "value"})
    result = CommandResult.error("文件不存在")
    result = CommandResult.exit("再见")

输出示例:
    CommandResult(success=True, message="操作成功", data={'key': 'value'}, should_exit=False)
    CommandResult(success=False, message="文件不存在", data=None, should_exit=False)
    CommandResult(success=True, message="再见", data=None, should_exit=True)
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class CommandResult:
    """命令执行结果数据类。

    封装命令执行后的返回信息，包括是否成功、提示消息、
    附加数据以及是否需要退出 Shell。

    Attributes:
        success: 命令是否执行成功
        message: 返回给用户的提示消息
        data: 附加数据字典，可选
        should_exit: 是否触发 Shell 退出，默认为 False
    """

    success: bool
    message: str
    data: Optional[dict[str, Any]] = None
    should_exit: bool = False

    @staticmethod
    def ok(message: str, data: Optional[dict[str, Any]] = None) -> "CommandResult":
        """创建成功结果。

        Args:
            message: 成功的提示消息
            data: 可选的附加数据字典

        Returns:
            一个表示成功的 CommandResult 实例
        """
        return CommandResult(success=True, message=message, data=data)

    @staticmethod
    def error(message: str, data: Optional[dict[str, Any]] = None) -> "CommandResult":
        """创建错误结果。

        Args:
            message: 错误的提示消息
            data: 可选的附加数据字典

        Returns:
            一个表示失败的 CommandResult 实例
        """
        return CommandResult(success=False, message=message, data=data)

    @staticmethod
    def exit(message: str = "再见!") -> "CommandResult":
        """创建退出结果。

        当返回此结果时，Shell 主循环检测到 should_exit=True 后会终止运行。

        Args:
            message: 退出前的告别消息，默认为 "再见!"

        Returns:
            一个触发退出的 CommandResult 实例
        """
        return CommandResult(success=True, message=message, should_exit=True)


class Command(ABC):
    """命令抽象基类。

    所有 CLI 命令都应继承此类并实现 execute() 方法。
    子类需要提供 name（命令名）、description（描述）以及 execute（执行逻辑）。

    Attributes:
        name: 命令名称，用户在 Shell 中输入的标识
        aliases: 命令别名列表，用于简化输入
        _subcommands: 子命令字典，键为子命令名，值为子命令实例
    """

    def __init__(self, name: str, aliases: Optional[list[str]] = None):
        """初始化命令。

        Args:
            name: 命令名称
            aliases: 命令别名列表，默认为空列表
        """
        self.name = name
        self.aliases = aliases or []
        # 子命令字典：用于聚合命令模式，如 project 命令包含 open/status 子命令
        self._subcommands: dict[str, Command] = {}

    @property
    @abstractmethod
    def description(self) -> str:
        """命令描述（抽象属性）。

        子类必须实现此属性，返回简短的命令说明文字。

        Returns:
            命令描述字符串
        """
        pass

    @property
    def usage(self) -> str:
        """命令用法示例。

        Returns:
            默认返回命令名称，子类可覆盖提供更详细的用法说明
        """
        return self.name

    @property
    def help_text(self) -> str:
        """完整的帮助文本。

        自动生成包含用法、描述和别名的帮助信息。

        Returns:
            格式化的多行帮助文本
        """
        lines = [
            f"用法: {self.usage}",
            "",
            self.description,
        ]
        if self.aliases:
            lines.append(f"别名: {', '.join(self.aliases)}")
        return "\n".join(lines)

    @abstractmethod
    def execute(self, args: list[str], context: "CommandContext") -> CommandResult:
        """执行命令（抽象方法）。

        子类必须实现此方法，包含命令的核心业务逻辑。

        Args:
            args: 命令参数列表（按空格分割后的字符串数组）
            context: 命令上下文，包含共享状态和项目信息

        Returns:
            命令执行结果（CommandResult）
        """
        pass

    def add_subcommand(self, name: str, command: "Command") -> None:
        """添加子命令。

        用于聚合命令模式，例如 project 命令包含 open/status/history 等子命令。

        Args:
            name: 子命令名称
            command: 子命令实例
        """
        self._subcommands[name] = command

    def get_subcommand(self, name: str) -> Optional["Command"]:
        """获取子命令。

        Args:
            name: 子命令名称

        Returns:
            子命令实例，如果不存在则返回 None
        """
        return self._subcommands.get(name)

    def list_subcommands(self) -> list[str]:
        """列出所有已注册的子命令名称。

        Returns:
            子命令名称列表
        """
        return list(self._subcommands.keys())


class CommandContext:
    """命令执行上下文。

    提供命令执行期间需要访问的共享状态。
    本质上是一个键值对容器，允许不同命令之间传递数据。

    使用示例:
        context.set("username", "admin")
        value = context.get("username")  # "admin"
    """

    def __init__(self):
        # 内部状态字典，存储所有上下文键值对
        self._state: dict[str, Any] = {}

    def set(self, key: str, value: Any) -> None:
        """设置上下文值。

        Args:
            key: 键名
            value: 任意类型的值
        """
        self._state[key] = value

    def get(self, key: str, default: Any = None) -> Any:
        """获取上下文值。

        Args:
            key: 键名
            default: 键不存在时返回的默认值

        Returns:
            键对应的值，如果键不存在则返回 default
        """
        return self._state.get(key, default)

    def has(self, key: str) -> bool:
        """检查上下文是否存在指定键。

        Args:
            key: 键名

        Returns:
            如果键存在于上下文中则返回 True，否则返回 False
        """
        return key in self._state


class ProjectContext(CommandContext):
    """项目上下文，扩展命令上下文。

    在 CommandContext 的基础上，增加了项目相关的专用属性：
    - project_path: 当前打开的项目目录路径
    - project_config: 当前项目的配置字典（通常从 project.precis.yaml 解析）

    通过 @property.setter 设置 project_path 或 project_config 时，
    会自动同步到父类的状态字典中，确保数据一致性。
    """

    def __init__(self):
        super().__init__()
        self._project_path: Optional[str] = None
        self._project_config: Optional[dict[str, Any]] = None

    @property
    def project_path(self) -> Optional[str]:
        """当前项目路径。

        Returns:
            已打开项目的绝对路径，未打开则返回 None
        """
        return self._project_path

    @project_path.setter
    def project_path(self, path: Optional[str]) -> None:
        """设置当前项目路径。

        同时自动同步到上下文字典中，便于统一访问。

        Args:
            path: 项目目录的绝对路径，或 None 表示关闭项目
        """
        self._project_path = path
        self.set("project_path", path)

    @property
    def project_config(self) -> Optional[dict[str, Any]]:
        """当前项目配置。

        Returns:
            项目配置字典（通常包含 project、settings、schemas 等字段），
            如果未加载则返回 None
        """
        return self._project_config

    @project_config.setter
    def project_config(self, config: Optional[dict[str, Any]]) -> None:
        """设置当前项目配置。

        同时自动同步到上下文字典中。

        Args:
            config: 项目配置字典，或 None 表示清空配置
        """
        self._project_config = config
        self.set("project_config", config)

    @property
    def is_project_open(self) -> bool:
        """是否已打开项目。

        Returns:
            如果 project_path 不为 None，说明已打开项目，返回 True
        """
        return self._project_path is not None
