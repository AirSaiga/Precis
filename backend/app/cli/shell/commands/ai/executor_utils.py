# backend/app/cli/shell/commands/ai/executor_utils.py
"""
@fileoverview AI 对话执行器模块

功能概述:
- 统一执行 AI 对话，确保 CLI 与 API 使用相同的底层逻辑
- 支持交互式确认、歧义解析、流式输出与 diff 展示
- 集成 Spinner 控制器（加载动画）与文件修改前后对比
- 负责将 AI 返回的动作（如添加约束）应用到项目配置文件中

架构设计:
- SpinnerController: 独立的线程控制器，在 AI 处理请求时显示旋转动画
- _get_provider_with_key(): 获取包含完整 API Key 的 Provider 配置
- _get_provider_display(): 获取用于显示的 Provider 配置（API Key 脱敏）
- _collect_all_config_files(): 在执行 AI 前收集所有配置文件内容，用于后续 diff 对比
- _generate_diff(): 使用 Python 标准库 difflib 生成统一差异格式（unified diff）
- _show_diff_summary(): 显示修改摘要（新增/删除/修改）并询问是否查看详细 diff
- _display_detailed_diff(): 使用颜色高亮显示详细的 diff 内容
- _display_execution_results(): 主入口，根据是否有文件修改决定如何展示结果
- execute_ai_chat(): 对外暴露的统一执行函数，协调所有子模块完成一次 AI 对话

输入示例:
    result = execute_ai_chat(
        message="在 users 表的 email 列添加非空约束",
        context=project_context,
        interactive=True,
        history=[],
        use_streaming=False,
    )

输出示例:
    CommandResult(
        success=True,
        message="",
        data={
            "reply": "已为您添加非空约束...",
            "actions": [...],
            "frontend_instructions": [...],
        },
    )
"""

import logging
import threading
import time
from pathlib import Path
from typing import Optional

from app.cli.shell.commands.ai.base import (
    mask_api_key,
)
from app.cli.shell.config_storage import get_cli_config
from app.cli.shell.formatter import Colors, Formatter
from app.shared.services.llm.config.models import AIProvider

logger = logging.getLogger(__name__)


class SpinnerController:
    """Spinner 控制器，支持暂停和恢复。

    在 AI 处理请求期间，在终端显示一个旋转的动画字符，
    提示用户程序正在工作中。支持在需要用户交互时暂停动画。

    Attributes:
        _stop_event: 线程事件，用于通知 spinner 线程停止
        _pause_event: 线程事件，用于通知 spinner 线程暂停
        _thread: spinner 后台线程实例
        _chars: 旋转动画使用的 Unicode 字符列表
    """

    def __init__(self):
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        # Unicode Braille 点字图案，用于终端旋转动画
        self._chars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

    def start(self):
        """启动 spinner 动画。

        创建并启动一个后台守护线程，循环显示旋转字符。
        """
        self._stop_event.clear()
        self._pause_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        """停止 spinner 动画。

        设置停止标志，等待线程结束，并清除终端上的 spinner 残留。
        """
        self._stop_event.set()
        self._pause_event.set()  # 确保线程能退出（如果正处于暂停状态）
        if self._thread:
            self._thread.join(timeout=1)
        # 清除 spinner 行：用空格覆盖并回车
        print(f"\r{' ' * 20}\r", end="", flush=True)

    def pause(self):
        """暂停 spinner（用于显示确认提示等需要用户输入的场景）。"""
        self._pause_event.set()
        # 清除当前 spinner 行，避免与后续输出重叠
        print(f"\r{' ' * 20}\r", end="", flush=True)

    def resume(self):
        """恢复 spinner 动画。"""
        self._pause_event.clear()

    def _run(self):
        """spinner 主循环。

        后台线程的运行方法，循环显示旋转字符直到收到停止信号。
        """
        i = 0
        while not self._stop_event.is_set():
            if not self._pause_event.is_set():
                char = self._chars[i % len(self._chars)]
                print(f"\r{Formatter.colorize('AI> ', Colors.CYAN)}{char}", end="", flush=True)
                i += 1
            time.sleep(0.1)


def _get_provider_with_key() -> Optional[AIProvider]:
    """
    获取包含完整 API Key 的 Provider 配置。

    从 CLI 配置中读取当前激活的 Provider（已通过 ConfigLoader 解密 api_key）。

    Returns:
        AIProvider 实例，如果未配置则返回 None
    """
    cli_config = get_cli_config()
    provider = cli_config.get_active_provider()

    if provider and provider.api_key:
        return provider
    return None


def _get_provider_display() -> Optional[dict[str, object]]:
    """获取用于显示的 Provider 配置（API Key 脱敏）。

    将 API Key 替换为掩码形式（如 abc123...xyz），避免在终端泄露密钥。

    Returns:
        脱敏后的 Provider 信息字典，如果未配置则返回 None
    """
    cli_config = get_cli_config()
    provider = cli_config.get_active_provider()

    if provider and provider.api_key:
        # 统一使用 AIProvider 的 type 字段（ProviderType 枚举）
        provider_type = provider.type.value if hasattr(provider.type, "value") else str(provider.type)
        return {
            "id": provider.id,
            "provider": provider_type,
            "api_key": mask_api_key(provider.api_key),
            "base_url": provider.base_url,
            "model": provider.model,
        }
    return None


def _collect_all_config_files(project_path: str) -> dict[str, str]:
    """收集项目所有配置文件的内容（用于 diff 对比）。

    在执行 AI 操作前调用，保存 schemas、constraints 和根配置文件的原始内容。
    AI 执行后，通过对比原始内容与修改后内容生成 diff。

    Args:
        project_path: 项目根目录路径

    Returns:
        字典，键为文件绝对路径，值为文件原始内容字符串
    """
    files_content = {}
    project = Path(project_path)

    # 收集 schemas 目录下的所有 .yaml 文件
    schemas_dir = project / "schemas"
    if schemas_dir.exists():
        for sf in schemas_dir.glob("*.yaml"):
            try:
                files_content[str(sf)] = sf.read_text(encoding="utf-8")
            except Exception:
                logger.error("读取 schema 文件失败", exc_info=True)

    # 收集 constraints 目录下的所有 .constraint.yaml 文件
    constraints_dir = project / "constraints"
    if constraints_dir.exists():
        for cf in constraints_dir.glob("*.constraint.yaml"):
            try:
                files_content[str(cf)] = cf.read_text(encoding="utf-8")
            except Exception:
                logger.error("读取 constraint 文件失败", exc_info=True)

    # 收集项目根目录下的核心配置文件
    for config_file in ["project.precis.yaml", "patterns.precis.yaml"]:
        config_path = project / config_file
        if config_path.exists():
            try:
                files_content[str(config_path)] = config_path.read_text(encoding="utf-8")
            except Exception:
                logger.error("读取配置文件失败", exc_info=True)

    return files_content
