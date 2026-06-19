# backend/app/cli/shell/formatter.py
"""
@fileoverview CLI Shell 输出格式化模块

功能概述:
- 基于 rich 库提供彩色终端输出和格式化工具
- 支持加载动画 Spinner、表格打印、验证结果格式化
- 打印欢迎信息与项目信息
- 保持 Colors/Formatter/Spinner 公共 API 不变，内部实现委托 rich

架构设计:
- Colors 定义 ANSI 颜色常量（兼容旧代码直接引用）
- Spinner 基于 rich.progress 实现终端加载动画
- Formatter 提供静态方法统一各类输出格式，内部使用 rich Console
"""

import sys
from typing import Any, Optional

from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TaskID, TextColumn
from rich.table import Table
from rich.text import Text

_console = Console(stderr=False)
_stderr_console = Console(stderr=True)


def _supports_unicode() -> bool:
    """检测当前 stdout 是否支持 Unicode 输出。"""
    try:
        encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
        "⠋".encode(encoding)
        return True
    except (UnicodeEncodeError, LookupError):
        return False


class Colors:
    """终端颜色常量。（保留以兼容旧代码直接引用）"""

    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"

    BLACK = "\033[30m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"

    BG_BLACK = "\033[40m"
    BG_RED = "\033[41m"
    BG_GREEN = "\033[42m"
    BG_YELLOW = "\033[43m"
    BG_BLUE = "\033[44m"
    BG_MAGENTA = "\033[45m"
    BG_CYAN = "\033[46m"
    BG_WHITE = "\033[47m"


class Spinner:
    """终端加载动画（基于 rich.progress）。"""

    ANIMATION_INTERVAL = 0.1

    def __init__(self, message: str = "处理中"):
        self.message = message
        self._success = True
        self._progress: Optional[Progress] = None
        self._task_id: Optional[TaskID] = None

    def start(self) -> None:
        self._progress = Progress(
            SpinnerColumn(),
            TextColumn("[cyan]{task.description}"),
            console=_console,
            transient=True,
        )
        self._progress.start()
        self._task_id = self._progress.add_task(self.message + "...", total=None)

    def stop(self, success: bool = True) -> None:
        self._success = success
        if self._progress:
            self._progress.stop()
            self._progress = None

        mark = "[green]✓[/green]" if success else "[red]✗[/red]"
        suffix = "[green] 完成[/green]" if success else "[red] 失败[/red]"
        _console.print(f"{mark} {self.message}{suffix}")


class Formatter:
    """输出格式化器。"""

    @staticmethod
    def colorize(text: str, *colors: str) -> str:
        color_codes = "".join(colors)
        return f"{color_codes}{text}{Colors.RESET}"

    @staticmethod
    def success(text: str) -> str:
        return Formatter.colorize(text, Colors.GREEN)

    @staticmethod
    def error(text: str) -> str:
        return Formatter.colorize(text, Colors.RED)

    @staticmethod
    def warning(text: str) -> str:
        return Formatter.colorize(text, Colors.YELLOW)

    @staticmethod
    def info(text: str) -> str:
        return Formatter.colorize(text, Colors.CYAN)

    @staticmethod
    def header(text: str) -> str:
        return Formatter.colorize(text, Colors.BOLD)

    @staticmethod
    def dim(text: str) -> str:
        return Formatter.colorize(text, Colors.DIM)

    @staticmethod
    def print_header(text: str, width: int = 50) -> None:
        _console.rule(Text(text.strip(), style="bold"), style="cyan", characters="═")

    @staticmethod
    def print_welcome() -> None:
        print()

        if _supports_unicode():
            logo = r"""
[bold cyan]██████╗ ██████╗ ███████╗ ██████╗██╗███████╗
██╔══██╗██╔══██╗██╔════╝██╔════╝██║██╔════╝
██████╔╝██████╔╝█████╗  ██║     ██║███████╗
██╔═══╝ ██╔══██╗██╔══╝  ██║     ██║╚════██║
██║     ██║  ██║███████╗╚██████╗██║███████║
╚═╝     ╚═╝  ╚═╝╚══════╝ ╚═════╝╚═╝╚══════╝[/bold cyan]"""
        else:
            logo = r"""
[bold cyan]  _____  ____   _____  ____  _____
 |  __ \|  _ \ / ____|/ __ \|_   _|
 | |__) | |_) | |    | |  | | | |
 |  ___/|  _ <| |    | |  | | | |
 | |    | |_) | |____| |__| |_| |_
 |_|    |____/ \_____|\____/|_____|[/bold cyan]"""

        subtitle = Text("Precis · Data Validation Engine", style="bold")
        version_text = Text("v0.1.0  CLI Interactive Shell", style="dim")

        _console.print(logo)
        _console.print()
        _console.print(
            Panel.fit(
                f"{subtitle}\n{version_text}",
                border_style="cyan",
                padding=(0, 4),
            )
        )

        print()
        _console.print("[dim]Type 'help' for available commands, 'exit' to exit, 'qq' to force quit[/dim]")
        print()

    @staticmethod
    def print_error(message: str) -> None:
        _stderr_console.print(f"[bold red]错误:[/bold red] {message}")

    @staticmethod
    def print_warning(message: str) -> None:
        _console.print(f"[yellow]警告:[/yellow] {message}")

    @staticmethod
    def print_success(message: str) -> None:
        _console.print(f"[green]{message}[/green]")

    @staticmethod
    def print_info(message: str) -> None:
        _console.print(f"[cyan]{message}[/cyan]")

    @staticmethod
    def print_table(headers: list[str], rows: list[list[Any]]) -> None:
        if not headers:
            return

        table = Table(show_header=True, header_style="bold")
        for h in headers:
            table.add_column(h)
        for row in rows:
            table.add_row(*[str(cell) for cell in row])
        _console.print(table)

    @staticmethod
    def format_validation_result(errors: list[dict[str, Any]], detailed: bool = True) -> str:
        if not errors:
            mark = "✓" if _supports_unicode() else "[OK]"
            return f"[green]\n{mark} 校验通过，未发现任何错误！\n[/green]"

        error_counts: dict[str, int] = {}
        for error in errors:
            error_type = error.get("error_type", "UnknownError")
            error_counts[error_type] = error_counts.get(error_type, 0) + 1

        lines = []
        lines.append("")
        total_errors = len(errors)

        lines.append(f"[bold]  总计: {total_errors} 个错误[/bold]")
        lines.append("")

        if error_counts:
            lines.append("[bold] 按类型统计:[/bold]")
            for error_type, count in sorted(error_counts.items()):
                type_display = error_type.replace("Violation", "").replace("Error", "")
                lines.append(f"   [yellow]•[/yellow] {type_display}: {count}")
            lines.append("")

        lines.append("[dim]" + "─" * 60 + "[/dim]")
        lines.append("[bold] 详细错误列表[/bold]")
        lines.append("[dim]" + "─" * 60 + "[/dim]")
        lines.append("")

        for i, error in enumerate(errors, 1):
            error_type = error.get("error_type", "UnknownError")
            message = error.get("message", "无错误信息")
            table_name = error.get("table", "")
            column = error.get("column", "")
            row_index = error.get("row_index")
            value = error.get("value")

            type_display = error_type.replace("Violation", "").replace("Error", "")
            type_color = "red" if "Violation" in error_type else "yellow"

            lines.append(f"  [bold][{i}][/bold] [{type_color}]【{type_display}】[/{type_color}]")

            if table_name:
                lines.append(f"      表: [cyan]{table_name}[/cyan]")
                if column:
                    lines.append(f"      列: [cyan]{column}[/cyan]")
                if row_index is not None:
                    lines.append(f"      行号: [cyan]{row_index}[/cyan]")
                if value is not None:
                    lines.append(f"      值: [yellow]{value}[/yellow]")

            lines.append(f"      [dim]消息:[/dim] {message}")
            lines.append("")

        lines.append("[cyan]" + "═" * 60 + "[/cyan]")

        return "\n".join(lines)

    @staticmethod
    def format_validation_summary(
        validation_details: dict[str, Any] | None,
        raw_datasets: dict[str, Any] | None = None,
    ) -> str:
        """格式化校验摘要：证明 validate 确实加载了数据并执行了约束。

        输出加载的表与行数、执行的约束检查数及各项通过/失败状态，
        用于消除"通过=没跑"的疑虑。

        Args:
            validation_details: executor 返回的 validation_details 字典，
                包含 format_checks / constraint_checks 两个列表；
                为空或结构异常时返回提示性兜底文本
            raw_datasets: executor 返回的原始数据集字典，用于统计每个表的行数；
                为空时表行数显示为"-"

        Returns:
            格式化的校验摘要文本（rich 标记字符串）
        """
        mark_ok = "✓" if _supports_unicode() else "[OK]"
        mark_fail = "✗" if _supports_unicode() else "[FAIL]"
        bullet = "•" if _supports_unicode() else "-"

        # 兜底：没有 validation_details 时无法证明执行情况，明确提示
        if not validation_details:
            return f"[yellow]{bullet} 未返回校验明细（validation_details 为空），无法确认实际执行的检查项数[/yellow]"

        # ---- 表/行数统计 ----
        format_checks = validation_details.get("format_checks", []) or []
        table_lines: list[str] = []
        for fc in format_checks:
            table = fc.get("table", "?")
            # 从 raw_datasets 取行数（DataFrame），取不到则显示 "-"
            ds = (raw_datasets or {}).get(table)
            row_count = len(ds) if ds is not None and hasattr(ds, "__len__") else "-"
            source = fc.get("source_file") or ""
            src_hint = f" [dim]({source})[/dim]" if source else ""
            table_lines.append(f"    {bullet} {table}: {row_count} 行{src_hint}")
        tables_block = "\n".join(table_lines) if table_lines else "    (无)"

        # ---- 约束检查统计 ----
        constraint_checks = validation_details.get("constraint_checks", []) or []
        total_checks = len(constraint_checks)
        failed_checks = [c for c in constraint_checks if not c.get("passed", True)]
        passed_count = total_checks - len(failed_checks)

        lines = [
            "",
            "[bold]  ┌ 校验摘要 ┐[/bold]",
            f"[bold]  数据表:[/bold] {len(format_checks)} 个",
            tables_block,
            f"[bold]  约束检查:[/bold] {total_checks} 项，"
            + (
                f"全部通过 {mark_ok}"
                if not failed_checks
                else f"{passed_count} 通过 / {len(failed_checks)} 失败 {mark_fail}"
            ),
        ]

        # 逐项约束结果（描述优先取 executor 提供的 description，否则用类型+表）
        if constraint_checks:
            lines.append("")
            for c in constraint_checks:
                passed = c.get("passed", True)
                ctype = (
                    c.get("constraint_type", "Constraint").replace("Constraint", "").replace("s", "", 1)
                    if c.get("constraint_type")
                    else "Constraint"
                )
                # description 形如 "非空约束: users.email"，直接用作可读标签
                desc = c.get("description") or f"{ctype}: {c.get('table', '?')}"
                tag = f"[green]{mark_ok}[/green]" if passed else f"[red]{mark_fail}[/red]"
                err_cnt = c.get("error_count", 0)
                err_hint = f" [red]({err_cnt} 错误)[/red]" if err_cnt else ""
                lines.append(f"    {bullet} {desc}  {tag}{err_hint}")

        return "\n".join(lines)

    @staticmethod
    def format_project_info(info: dict[str, Any]) -> str:
        lines = []
        lines.append("[bold]\n项目信息:[/bold]")
        lines.append(f"  名称: {info.get('name', '未命名')}")
        lines.append(f"  路径: {info.get('path', '')}")
        lines.append(f"  Schema 数量: {info.get('schemas_count', 0)}")
        lines.append(f"  约束数量: {info.get('constraints_count', 0)}")

        if info.get("tables"):
            lines.append("[bold]\n数据表:[/bold]")
            for table in info["tables"]:
                lines.append(f"  - {table}")

        return "\n".join(lines)
