# backend/app/cli/shell/commands/open.py
"""
@fileoverview CLI Shell 打开项目命令模块

功能概述:
- 提供 open 命令：打开并切换工作项目，维护项目历史记录
- 管理项目打开历史（持久化到 ~/.precis_project_history）

架构设计:
- OpenCommand 作为顶层命令注册，同时被 ProjectCommand 复用为子命令
- 历史记录使用 JSON 文件持久化，支持去重与容量限制（MAX_HISTORY = 10）
- 错误处理通过 CommandResult.error 直接返回，不抛出异常

输入示例:
    open /path/to/project
    project open /path/to/project

输出示例:
    CommandResult(success=True, message="已切换到项目: /path/to/project")
"""

import json
import logging
import os

from app.cli.shell.commands.base import Command, CommandContext, CommandResult

# 历史记录文件路径：存储在用户主目录下
HISTORY_FILE = os.path.expanduser("~/.precis_project_history")
# 最大历史记录数量，超过时会自动丢弃最旧的项目
MAX_HISTORY = 10


def _load_history() -> list[dict]:
    """加载项目打开历史。

    从 ~/.precis_project_history 文件中读取历史记录。
    如果文件不存在、格式损坏或权限不足，返回空列表。

    Returns:
        历史记录列表，每个元素为包含 path 和 last_opened 的字典
    """
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        # JSON 格式损坏，返回空列表
        return []
    except PermissionError:
        # 无权限读取，返回空列表
        return []
    except OSError:
        # 其他操作系统错误（如文件被锁定），返回空列表
        return []


def _save_history(history: list[dict]) -> None:
    """保存项目打开历史。

    将历史记录写入 ~/.precis_project_history 文件。

    Args:
        history: 历史记录列表
    """
    try:
        # 确保目录存在（用户主目录）
        os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except (PermissionError, OSError):
        # 保存失败时记录错误日志，但不阻断主流程
        logging.error("保存项目历史记录失败", exc_info=True)


def _add_to_history(project_path: str) -> None:
    """将项目路径添加到历史记录顶部。

    如果路径已存在，先移除旧记录，再插入到顶部。
    超过最大容量时自动截断。

    Args:
        project_path: 项目的绝对路径
    """
    history = _load_history()
    # 去重：移除已存在的相同路径
    history = [h for h in history if h.get("path") != project_path]
    # 插入到列表头部（最新的项目）
    history.insert(0, {"path": project_path, "last_opened": None})
    # 容量控制：只保留最近的 MAX_HISTORY 个项目
    if len(history) > MAX_HISTORY:
        history = history[:MAX_HISTORY]
    _save_history(history)


class OpenCommand(Command):
    """打开项目命令。

    支持三种调用方式：
        open               → 从历史记录交互选择（箭头/数字键，Enter=最近项目）
        open <N>           → 打开历史列表第 N 个项目（1-based）
        open <项目路径>     → 按路径打开项目

    打开成功后更新上下文（project_path/project_config）并写入历史记录。
    """

    def __init__(self):
        super().__init__("open", aliases=["o"])

    @property
    def description(self) -> str:
        return "打开一个项目目录并切换当前上下文（无参数从历史选择）"

    @property
    def usage(self) -> str:
        return "open [项目路径 | 序号]（无参数则从历史选择）"

    def execute(self, args: list[str], ctx: CommandContext) -> CommandResult:
        """执行打开项目命令。

        支持三种调用方式：
            open                 → 方案A：无参数，从历史记录交互选择
            open <N>             → 方案B：打开历史列表第 N 个项目（1-based）
            open <项目路径>       → 按路径打开项目

        Args:
            args: 命令参数列表
            ctx: 命令上下文，用于保存当前项目路径

        Returns:
            命令执行结果
        """
        # 方案A：无参数 → 交互式从历史选择
        if not args:
            return self._open_from_history(ctx)

        # 方案B：纯数字参数 → 按历史序号打开（拦截在路径解析之前，
        # 避免 "1" 被当成名为 "1" 的路径；真有同名目录可用 open ./1 绕过）
        if args[0].isdigit():
            return self._open_by_index(args[0], ctx)

        # 默认：按路径打开
        return self._do_open_path(os.path.abspath(args[0]), ctx)

    def _do_open_path(self, project_path: str, ctx: CommandContext) -> CommandResult:
        """按绝对路径打开项目的公共逻辑（供方案A/B/路径模式复用）。

        执行：存在性校验 → 设 ctx.project_path → 写历史 → 加载清单 → 构造消息。

        Args:
            project_path: 项目目录的绝对路径
            ctx: 命令上下文

        Returns:
            命令执行结果
        """
        if not os.path.exists(project_path):
            return CommandResult(success=False, message=f"项目路径不存在: {project_path}")
        if not os.path.isdir(project_path):
            return CommandResult(success=False, message=f"路径不是目录: {project_path}")

        # 更新上下文中的项目路径
        ctx.project_path = project_path
        # 添加到历史记录
        _add_to_history(project_path)

        # 定位清单文件，兼容 .yaml / .yml 两种后缀
        manifest_path = self._find_manifest(project_path)

        # 加载清单到上下文，使提示符与后续命令能读取真实项目名等配置。
        # 加载失败不阻断切换项目，仅清空配置并给出警告（空值已在消费侧做了守卫）。
        load_warning = ""
        if manifest_path is not None:
            loaded = self._load_manifest_config(manifest_path)
            if loaded is not None:
                ctx.project_config = loaded
            else:
                ctx.project_config = None
                load_warning = "\n警告：project.precis.yaml 存在但解析失败，配置未加载"
        else:
            ctx.project_config = None

        msg = f"已切换到项目: {project_path}"
        if manifest_path is not None:
            msg += "\n检测到项目清单文件 (project.precis.yaml)"
        else:
            msg += "\n警告：未找到 project.precis.yaml，可能需要初始化项目"
        msg += load_warning

        return CommandResult(success=True, message=msg)

    def _open_from_history(self, ctx: CommandContext) -> CommandResult:
        """方案A：无参数时从历史记录交互选择项目。

        使用 InteractiveMenu 渲染历史项目列表（光标默认停在最近项目，
        直接 Enter 即可打开上次项目）。空历史或取消时返回提示，不报错。

        Args:
            ctx: 命令上下文

        Returns:
            命令执行结果
        """
        # 延迟导入：InteractiveMenu 依赖 readchar，仅在交互分支才需要
        from app.cli.shell.interactive_menu import InteractiveMenu

        history = _load_history()
        if not history:
            return CommandResult(
                success=True,
                message="暂无项目打开历史。请先使用 'open <项目路径>' 打开一个项目。",
            )

        # 构建菜单项：key=项目路径，label=项目名（优先 manifest，否则目录名），description=完整路径
        menu = InteractiveMenu("从历史记录中选择项目:", show_cancel=True)
        for item in history:
            path = item.get("path", "")
            if not path:
                continue
            label = self._resolve_project_label(path)
            menu.add_item(key=path, label=label, description=path)

        if not menu.items:
            return CommandResult(
                success=True,
                message="历史记录中无有效项目路径。请使用 'open <项目路径>' 打开项目。",
            )

        selected_path = menu.show()
        if selected_path is None:
            # 用户取消（ESC / 0 / 选了取消项）
            return CommandResult(success=True, message="已取消。")

        return self._do_open_path(selected_path, ctx)

    def _open_by_index(self, index_str: str, ctx: CommandContext) -> CommandResult:
        """方案B：按历史序号打开项目（1-based）。

        Args:
            index_str: 用户输入的纯数字字符串
            ctx: 命令上下文

        Returns:
            命令执行结果
        """
        history = _load_history()
        if not history:
            return CommandResult(
                success=False,
                message="暂无项目打开历史，无法按序号打开。请使用 'open <项目路径>' 打开项目。",
            )

        # 解析序号（已在 execute 中确认 isdigit()，此处再防御一次）
        try:
            index = int(index_str)
        except ValueError:
            return CommandResult(success=False, message=f"无效的序号: {index_str}")

        if index < 1 or index > len(history):
            return CommandResult(
                success=False,
                message=f"无此历史项: {index}（共 {len(history)} 项，使用 'project history' 查看列表）",
            )

        path = history[index - 1].get("path", "")
        if not path:
            return CommandResult(success=False, message=f"历史项 {index} 缺少路径信息")

        return self._do_open_path(path, ctx)

    @staticmethod
    def _resolve_project_label(project_path: str) -> str:
        """解析项目用于菜单显示的名称。

        优先读取 project.precis.yaml 中的 project.name，失败则降级为目录名。
        用于交互菜单 label，不做完整项目加载。

        Args:
            project_path: 项目根目录绝对路径

        Returns:
            项目显示名称
        """
        manifest_path = OpenCommand._find_manifest(project_path)
        if manifest_path is not None:
            config = OpenCommand._load_manifest_config(manifest_path)
            if config is not None:
                name = config.get("project", {}).get("name")
                if name:
                    return str(name)
        # 降级：目录名
        return os.path.basename(project_path) or project_path

    @staticmethod
    def _find_manifest(project_path: str) -> str | None:
        """定位项目清单文件，兼容 .yaml / .yml 后缀。

        Args:
            project_path: 项目根目录绝对路径

        Returns:
            清单文件绝对路径；不存在则返回 None
        """
        # 优先 .yaml 后缀（项目规范）
        primary = os.path.join(project_path, "project.precis.yaml")
        if os.path.isfile(primary):
            return primary
        # 兼容 .yml 后缀
        alt = os.path.join(project_path, "project.precis.yml")
        if os.path.isfile(alt):
            return alt
        return None

    @staticmethod
    def _load_manifest_config(manifest_path: str) -> dict | None:
        """加载并序列化清单为字典。

        复用 shared/core 中的 load_manifest 以保持与系统其余部分解析一致，
        返回 model_dump() 字典以匹配 ctx.project_config 的 dict 消费约定。

        Args:
            manifest_path: 清单文件绝对路径

        Returns:
            清单配置字典；解析失败时返回 None（由调用方决定如何提示）
        """
        try:
            # 延迟导入：避免在未使用 open 命令时引入 shared.core 的依赖链。
            # 注意 manifest 为 namespace package，需直接从 reader 子模块导入。
            from app.shared.core.project.manifest.reader import load_manifest

            manifest = load_manifest(manifest_path)
            return manifest.model_dump(exclude_none=True)
        except Exception as e:
            # 记录日志但不抛出，避免加载失败阻断项目切换
            logging.warning("加载项目清单失败: %s", e, exc_info=True)
            return None
