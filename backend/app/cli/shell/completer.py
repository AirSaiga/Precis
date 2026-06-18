# backend/app/cli/shell/completer.py
"""
@fileoverview CLI Shell Tab 补全模块

功能概述:
- 为交互式 REPL 提供命令名 + 子命令名的 Tab 补全
- Windows 使用 pyreadline3，Unix 使用 stdlib readline，两者均不可用时静默降级
- 通过 readline 的 completer 协议接入原生 input()

架构设计:
- install_readline_completer(): 导入 readline 后端并注册补全函数，返回是否成功
- _make_completer(): 工厂函数，返回符合 readline 协议的 complete(text, state) 闭包
- 补全分两层：顶层命令（含别名）/ 子命令（含别名）

输入示例（REPL 内）:
    precis> val<Tab>         → validate
    precis> che<Tab>         → check（validate 别名）
    precis> project <Tab>    → 列出 open/status/history

输出示例:
    install_readline_completer(registry) -> True  # 成功注册
    install_readline_completer(registry) -> False # 无可用 readline 后端，降级
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # 仅用于类型注解（from __future__ annotations 使注解为字符串），
    # 运行时无需导入，避免与 parser→commands→parser 的循环导入。
    from app.cli.shell.parser import CommandRegistry


def _import_readline():
    """导入 readline 后端。

    Unix 上 stdlib readline 可用；Windows 上 stdlib 无 readline，
    退回到 pyreadline3（需 pip install pyreadline3 或 precis[completion]）。

    Returns:
        readline 模块对象；两者都不可用时返回 None
    """
    try:
        # Unix: stdlib readline；部分 Windows 构建（如 Anaconda）也可能内置
        import readline
    except ImportError:
        try:
            # Windows: 退回 pyreadline3（与 stdlib readline 接口兼容）
            import pyreadline3 as readline
        except ImportError:
            return None
    return readline


def install_readline_completer(registry: CommandRegistry) -> bool:
    """安装 Tab 补全到 readline 后端。

    配置 tab: complete、设置分词分隔符、注册补全函数。
    仅在交互 REPL 启动时调用一次。

    Args:
        registry: 命令注册表，补全函数据此提供候选

    Returns:
        True 表示成功注册（补全可用）；
        False 表示无可用 readline 后端，调用方应降级为无补全模式
    """
    readline = _import_readline()
    if readline is None:
        return False

    # tab 键触发补全（标准 readline 配置）
    readline.parse_and_bind("tab: complete")
    # 命令/子命令补全按空格分词，不依赖标点等其他分隔符
    readline.set_completer_delims(" \t\n")
    # 注册补全函数
    readline.set_completer(_make_completer(registry))
    return True


def _make_completer(registry: CommandRegistry):
    """构造 readline completer 闭包。

    readline 协议：对同一 text 反复调用，state 从 0 递增，
    依次返回匹配候选，耗尽后返回 None。

    Args:
        registry: 命令注册表

    Returns:
        complete(text, state) -> Optional[str] 函数
    """
    # 每次补全会话缓存候选列表，避免每个 state 重复计算
    # （readline 对同一 text 调用 complete(text,0..N)，state=0 时重建列表）
    cached: dict[str, list[str]] = {}

    def complete(text: str, state: int) -> str | None:
        # 延迟导入 readline：测试时可用 monkeypatch 替换 get_line_buffer
        readline = _import_readline()
        if readline is None:
            return None

        # state=0 表示新一轮补全，重建候选缓存
        if state == 0:
            cached[text] = _compute_candidates(registry, readline, text)

        candidates = cached.get(text, [])
        if state < len(candidates):
            return candidates[state]
        return None

    return complete


def _compute_candidates(registry: CommandRegistry, readline, text: str) -> list[str]:
    """计算当前补全候选列表。

    两层补全逻辑：
    - 顶层：line_buffer 未出现已完成（带空格）的命令 → 候选为所有命令名+别名
    - 子命令层：line_buffer 首词匹配到有子命令的命令 → 候选为该命令的子命令名+别名
    - 其他（无子命令的命令，或已输入到第三词及以后）→ 空列表（不补全）

    Args:
        registry: 命令注册表
        readline: readline 后端（用于 get_line_buffer）
        text: 当前正在输入的 token（readline 传入）

    Returns:
        匹配候选列表，已按字典序排序；每项在完整匹配时追加尾部空格
    """
    try:
        line_buffer = readline.get_line_buffer()
    except Exception:
        # get_line_buffer 不可用时退化为仅用 text 做顶层补全
        line_buffer = text

    # 判断是否处于"正在输入第一个词"阶段：
    # 若 line_buffer 去除尾部 text 后不含空格，说明还在第一个词
    buffer_before_text = line_buffer[: len(line_buffer) - len(text)]
    in_first_word = buffer_before_text.strip() == ""

    if in_first_word:
        # 顶层命令补全（含别名）
        return _filter_and_decorate(_collect_top_level(registry), text)

    # 已完成第一个词，尝试子命令补全。
    # 关键：区分"已完成词"与"正在输入的词"。line_buffer 末尾若无空格，
    # 说明最后那个 token 就是当前正在输入的词（即 text），不计入已完成词。
    all_tokens = line_buffer.split()
    trailing_space = line_buffer.endswith(" ")
    # 已完成的词数：末尾有空格 → all_tokens 全是已完成；否则最后一个正在输入
    completed_tokens = all_tokens if trailing_space else all_tokens[:-1]

    first_word = completed_tokens[0] if completed_tokens else ""
    command = registry.get(first_word)
    if command is None:
        return []

    sub_names = command.list_subcommands()
    if not sub_names:
        # 该命令无子命令，不补全（参数/路径补全留给未来）
        return []

    # 仅当"正在输入第二个词"（completed_tokens 恰好 1 个）才补全子命令；
    # 若已完成 2 个及以上词，说明在输第三词或更后，不再补全子命令。
    if len(completed_tokens) >= 2:
        return []

    candidates: list[str] = []
    for sub_name in sub_names:
        candidates.append(sub_name)
        sub_cmd = command.get_subcommand(sub_name)
        if sub_cmd is not None:
            candidates.extend(sub_cmd.aliases)

    return _filter_and_decorate(candidates, text)


def _collect_top_level(registry: CommandRegistry) -> list[str]:
    """收集所有顶层命令名 + 别名。"""
    names: list[str] = []
    for cmd in registry.get_all_commands():
        names.append(cmd.name)
        names.extend(cmd.aliases)
    return names


def _filter_and_decorate(candidates: list[str], text: str) -> list[str]:
    """过滤出以 text 开头的候选，去重排序，并对完整匹配项追加尾部空格。

    readline 在单候选时会自动补全到完整词；追加空格让用户补全命令名后
    可直接继续输入子命令/参数，符合 shell 惯例。

    Args:
        candidates: 原始候选列表（可能含重复）
        text: 前缀过滤条件

    Returns:
        处理后的候选列表
    """
    seen: set[str] = set()
    matched: list[str] = []
    for c in candidates:
        if c.startswith(text) and c not in seen:
            seen.add(c)
            # 完整匹配（text 非空且等于候选）时追加空格；
            # 前缀补全（text 是候选的前缀）由 readline 自动补齐，也加空格提升体验
            matched.append(c + " " if text else c)
    matched.sort()
    return matched


# Command 仅用于类型注解引用，避免 ruff 报未使用导入
__all__ = ["install_readline_completer", "_import_readline", "_make_completer", "_compute_candidates"]
