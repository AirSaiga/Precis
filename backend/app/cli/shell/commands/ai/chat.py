# backend/app/cli/shell/commands/ai/chat.py
"""
@fileoverview AI 交互式对话命令模块

功能概述:
- 提供 ai chat 子命令进入交互式 AI 对话模式
- 支持流式输出开关（--stream / --no-stream）
- 管理对话历史记录，支持清空、查看统计
- 过滤孤立确认词（如 "ok"、"好的"），避免误触发 AI 调用
- 支持内置指令：help、clear、history、exit、quit、qq

架构设计:
- AIChatCommand 继承 Command 基类，实现 execute() 方法
- execute() 方法启动一个 while True 循环，持续读取用户输入
- 对话历史以 list[dict] 形式维护，每个元素包含 role（user/assistant）和 content
- 当历史记录的 Token 数超过限制时，自动截断最早的消息（保留系统提示词）

输入示例:
    precis> ai chat
    你: 在 users 表添加非空约束
    AI: 已为您添加非空约束...

    你: help
    （显示帮助信息）

    你: clear
    （清空历史）

输出示例:
    CommandResult.ok("")
"""

from app.cli.shell.commands.ai.base import build_context_data
from app.cli.shell.commands.ai.executor import execute_ai_chat
from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.config_storage import get_cli_config
from app.cli.shell.formatter import Colors, Formatter
from app.shared.services.ai.utils import (
    estimate_tokens,
    truncate_history_by_tokens,
)
from app.shared.services.llm.chat.chat_system_prompt import build_system_prompt
from app.shared.services.llm.providers.base import resolve_context_window


class AIChatCommand(Command):
    """AI 交互式对话命令。

    启动一个持续运行的对话会话，用户可以反复输入自然语言指令与 AI 交互。
    支持历史记录管理、Token 限制保护、内置快捷指令。

    上下文窗口大小从 Provider 配置或内置模型表中自动获取，
    不再硬编码为 120k。
    """

    # 为模型回复预留的 token 预算
    RESERVED_OUTPUT_TOKENS = 8000

    def __init__(self):
        super().__init__("chat")
        self._cli_config = get_cli_config()

    @property
    def description(self) -> str:
        return "进入 AI 交互式对话模式"

    @property
    def usage(self) -> str:
        return "ai chat [--stream | --no-stream]"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行 AI 交互式对话命令。

        检查项目和 AI 配置，解析命令行参数，然后进入交互式输入循环。

        Args:
            args: 命令参数列表，可能包含 --stream 或 --no-stream
            context: 命令上下文，必须包含已打开的项目

        Returns:
            命令执行结果，退出对话后返回成功结果
        """
        if not context.is_project_open:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        # 检查 AI 配置（使用 CLI 配置）
        provider = self._cli_config.get_active_provider()
        if not provider:
            return CommandResult.error("没有可用的 LLM Provider 配置\n请先运行 'setup' 命令配置 API Key")

        # 解析命令行参数
        use_streaming = False  # 默认禁用流式输出，显示 loading spinner
        filtered_args = []
        for arg in args:
            if arg == "--stream":
                use_streaming = True
            elif arg == "--no-stream":
                use_streaming = False
            else:
                filtered_args.append(arg)

        if filtered_args:
            return CommandResult.error(f"未知参数: {filtered_args}\n用法: {self.usage}")

        # 获取项目名称用于显示（project_config 在 open 后可能尚未加载，做空值守卫）
        config = context.project_config or {}
        project_name = config.get("project", {}).get("name", "project")

        # 根据 Provider 配置和模型名获取上下文窗口（用户输入 > 自动探测 > 全局回退）
        self._context_window = resolve_context_window(provider)
        self._max_context_tokens = max(self._context_window - self.RESERVED_OUTPUT_TOKENS, 4096)

        # 打印会话头信息
        print(Formatter.header("\nAI 助手交互模式"))
        print(Formatter.info(f"项目: {project_name}"))
        print(Formatter.info(f"Provider: {provider.name}"))
        print(Formatter.info(f"Model: {provider.model}"))
        print(Formatter.info(f"流式输出: {'开启' if use_streaming else '关闭'}"))
        print(Formatter.info(f"上下文限制: {self._context_window:,} tokens"))
        print(Formatter.info("\n提示: 输入 'exit' 或 'quit' 退出对话，'help' 查看帮助，'clear' 清空历史"))
        print(Formatter.header(""))

        # 对话历史：存储用户和 AI 的消息，用于多轮对话
        chat_history: list[dict[str, str]] = []

        while True:
            try:
                # 获取用户输入（带绿色提示符）
                prompt = Formatter.colorize("\n你: ", Colors.GREEN)
                user_input = input(prompt).strip()

                if not user_input:
                    continue

                # 内置指令处理
                if user_input.lower() in ("exit", "quit", "q"):
                    print(Formatter.success("\n再见!"))
                    break

                if user_input.lower() in ("exit!", "quit!", "qq"):
                    print(Formatter.success("\n再见!"))
                    import sys

                    sys.exit(0)

                if user_input.lower() == "help":
                    self._print_help()
                    continue

                if user_input.lower() == "clear":
                    chat_history = []
                    print(Formatter.info("对话历史已清空"))
                    continue

                if user_input.lower() == "history":
                    self._print_history_stats(chat_history)
                    continue

                # 忽略孤立的确认/回应词（用户可能只是回应 AI，而非执行命令）
                # 但如果是疑问句或包含其他内容，则正常处理
                acknowledgment_words = {
                    "ok",
                    "okay",
                    "yes",
                    "yep",
                    "yeah",
                    "y",
                    "好的",
                    "知道了",
                    "明白",
                    "收到",
                    "嗯",
                    "哦",
                    "thanks",
                    "thank you",
                    "谢谢",
                    "谢了",
                    "got it",
                    "了解了",
                    "清楚",
                    "好",
                    "可以",
                    "行",
                }
                input_lower = user_input.lower()
                # 只过滤单独的确认词（不包含问号、不是疑问句）
                if input_lower in acknowledgment_words and len(input_lower) < 20:
                    print(Formatter.dim("（已忽略确认词。输入 'help' 查看命令，或输入具体问题与 AI 对话）"))
                    continue

                # 执行 AI 对话（调用统一执行器）
                result = execute_ai_chat(
                    user_input,
                    context,
                    interactive=True,
                    history=chat_history,
                    use_streaming=use_streaming,
                )

                if result.success and result.data:
                    # 更新历史：将用户消息和 AI 回复加入历史
                    reply = result.data.get("reply", "")
                    chat_history.append({"role": "user", "content": user_input})
                    chat_history.append({"role": "assistant", "content": reply})

                    # 根据 Token 数截断历史（安全机制，防止超出模型上下文窗口）
                    context_data = build_context_data("", context)
                    system_prompt = build_system_prompt(context_data)
                    chat_history = truncate_history_by_tokens(
                        chat_history, system_prompt, max_tokens=self._max_context_tokens
                    )
                elif not result.success:
                    # 处理错误情况
                    print(Formatter.error(f"\n请求失败: {result.message}"))
                else:
                    # result.success 为 True 但 data 为空（异常情况）
                    print(Formatter.warning("\n收到空响应，未更新历史记录"))

            except KeyboardInterrupt:
                # 用户按 Ctrl+C，提示如何正确退出
                print()
                print(Formatter.info("\n使用 'exit' 或 'quit' 退出对话"))
            except EOFError:
                # 输入流结束（如管道输入），优雅退出
                print()
                print(Formatter.success("\n再见!"))
                break

        return CommandResult.ok("")

    def _print_help(self) -> None:
        """打印 AI 交互式对话的帮助信息。

        列出所有可用命令、启动选项以及自然语言示例。
        """
        help_text = """
AI 助手帮助

可用命令:
  help         - 显示此帮助信息
  history      - 显示对话历史统计
  clear        - 清空对话历史
  exit         - 退出对话模式（返回 CLI）
  qq           - 直接退出整个程序（全局可用）

启动选项:
  --stream     - 启用流式输出
  --no-stream  - 禁用流式输出（默认，显示 loading spinner）

你可以用自然语言描述你的需求，例如:
  - "在 users 表的 email 列上添加非空约束"
  - "给 orders 表的 amount 列添加范围约束，最小值 0"
  - "删除 users 表 phone 列上的唯一约束"
  - "显示当前所有的约束配置"

支持的约束类型:
  - NotNull: 非空约束
  - Unique: 唯一约束
  - AllowedValues: 允许值约束 (如: "allowedValues 为 A, B")
  - Range: 范围约束 (如: "最小值 0, 最大值 100")
  - Scripted: 脚本/正则约束 (如: "正则匹配 ^[0-9]+$")
  - ForeignKey: 外键约束 (如: "关联到 orders 表的 user_id 列")
  - Conditional: 条件约束 (如: "如果 type 等于 A 则值为 B")
  - DateLogic: 日期逻辑约束 (如: "日期晚于 2023-01-01")
        """
        print(Formatter.info(help_text))

    def _print_history_stats(self, chat_history: list[dict[str, str]]) -> None:
        """显示对话历史统计信息。

        统计消息总数、用户/AI 消息数量、估算 Token 数及上下文使用率。

        Args:
            chat_history: 当前对话历史列表
        """
        if not chat_history:
            print(Formatter.info("\n对话历史为空"))
            return

        # 计算统计信息
        total_messages = len(chat_history)
        user_messages = sum(1 for m in chat_history if m.get("role") == "user")
        assistant_messages = sum(1 for m in chat_history if m.get("role") == "assistant")

        # 计算 Token 数（估算）
        total_tokens = 0
        for msg in chat_history:
            total_tokens += estimate_tokens(msg.get("content", ""))

        # 系统提示词 Token 估算（系统提示词不显示在历史中，但占用 Token）
        system_tokens = 2000  # 估算值
        total_with_system = total_tokens + system_tokens

        # 计算使用率百分比（基于完整上下文窗口）
        context_window = getattr(self, "_context_window", 120000)
        usage_percent = (total_with_system / context_window) * 100

        print(Formatter.info("\n对话历史统计:"))
        print(f"  消息总数: {total_messages}")
        print(f"    - 用户消息: {user_messages}")
        print(f"    - AI 回复: {assistant_messages}")
        print(f"  估算 Token: {total_with_system:,} / {context_window:,}")
        print(f"  使用率: {usage_percent:.1f}%")

        # 显示最近几条消息预览
        preview_count = min(3, len(chat_history) // 2)
        if preview_count > 0:
            print(f"\n  最近 {preview_count} 轮对话:")
            for i in range(-preview_count * 2, 0, 2):
                if abs(i) <= len(chat_history):
                    user_msg = chat_history[i] if i < 0 and abs(i) <= len(chat_history) else None
                    if user_msg and user_msg.get("role") == "user":
                        content = user_msg.get("content", "")[:30]
                        if len(user_msg.get("content", "")) > 30:
                            content += "..."
                        print(f"    - {content}")
