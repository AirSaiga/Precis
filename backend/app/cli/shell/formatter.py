# backend/app/cli/shell/formatter.py
"""
@fileoverview CLI Shell 输出格式化模块

功能概述:
- 提供彩色终端输出和格式化工具
- 支持加载动画 Spinner、表格打印、验证结果格式化
- 打印欢迎信息与项目信息

架构设计:
- Colors 定义 ANSI 颜色常量
- Spinner 使用独立线程实现终端加载动画
- Formatter 提供静态方法统一各类输出格式
"""

import sys
import threading
import time
from typing import Any, Optional


class Colors:
    """终端颜色常量。"""

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
    """终端加载动画。"""

    FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    SUCCESS_FRAMES = ["✓", "✓", "✓"]
    ERROR_FRAMES = ["✗", "✗", "✗"]
    ANIMATION_INTERVAL = 0.1  # 动画帧间隔（秒）

    def __init__(self, message: str = "处理中"):
        self.message = message
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        """启动加载动画。"""
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._animate, daemon=True)
        self._thread.start()

    def stop(self, success: bool = True) -> None:
        """停止加载动画。

        Args:
            success: 是否显示成功状态
        """
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=1)

        frames = self.SUCCESS_FRAMES if success else self.ERROR_FRAMES
        frame = frames[0]
        suffix = Formatter.success(" 完成") if success else Formatter.error(" 失败")
        print(f"\r{Colors.CYAN}{frame}{Colors.RESET} {self.message}{suffix}")

    def _animate(self) -> None:
        """动画循环。"""
        index = 0
        while not self._stop_event.is_set():
            frame = self.FRAMES[index % len(self.FRAMES)]
            print(f"\r{Colors.CYAN}{frame}{Colors.RESET} {self.message}...", end="", flush=True)
            index += 1
            time.sleep(self.ANIMATION_INTERVAL)


class Formatter:
    """输出格式化器。"""

    @staticmethod
    def colorize(text: str, *colors: str) -> str:
        """为文本添加颜色。

        Args:
            text: 要着色的文本
            colors: 颜色代码

        Returns:
            着色后的文本
        """
        color_codes = "".join(colors)
        return f"{color_codes}{text}{Colors.RESET}"

    @staticmethod
    def success(text: str) -> str:
        """绿色成功文本。"""
        return Formatter.colorize(text, Colors.GREEN)

    @staticmethod
    def error(text: str) -> str:
        """红色错误文本。"""
        return Formatter.colorize(text, Colors.RED)

    @staticmethod
    def warning(text: str) -> str:
        """黄色警告文本。"""
        return Formatter.colorize(text, Colors.YELLOW)

    @staticmethod
    def info(text: str) -> str:
        """蓝色信息文本。"""
        return Formatter.colorize(text, Colors.CYAN)

    @staticmethod
    def header(text: str) -> str:
        """粗体标题文本。"""
        return Formatter.colorize(text, Colors.BOLD)

    @staticmethod
    def dim(text: str) -> str:
        """暗淡文本。"""
        return Formatter.colorize(text, Colors.DIM)

    @staticmethod
    def print_header(text: str, width: int = 50) -> None:
        """打印带边框的标题。

        Args:
            text: 标题文本
            width: 边框宽度
        """
        border = "=" * width
        print(Formatter.colorize(border, Colors.CYAN))
        print(Formatter.header(f"{text:^{width}}"))
        print(Formatter.colorize(border, Colors.CYAN))

    @staticmethod
    def print_welcome() -> None:
        """打印欢迎信息。"""
        print()
        print(
            Formatter.colorize(
                r"""
  ____                _        _    ____ _
 / ___|_ __ _   _ ___| |_ __ _| |  / ___| | ___  __ _ _ __
| |   | '__| | | / __| __/ _` | | | |   | |/ _ \/ _` | '__|
| |___| |  | |_| \__ \ || (_| | | | |___| |  __/ (_| | |
 \____|_|   \__, |___/\__\__,_|_|  \____|_|\___|\__,_|_|
            |___/
        """,
                Colors.CYAN,
                Colors.BOLD,
            )
        )
        print()
        print(Formatter.header("                       CLI Interactive Shell"))
        print()
        print(Formatter.dim("Type 'help' for available commands, 'exit' to exit, 'qq' to force quit"))
        print()

    @staticmethod
    def print_error(message: str) -> None:
        """打印错误信息。"""
        print(Formatter.error(f"错误: {message}"), file=sys.stderr)

    @staticmethod
    def print_warning(message: str) -> None:
        """打印警告信息。"""
        print(Formatter.warning(f"警告: {message}"))

    @staticmethod
    def print_success(message: str) -> None:
        """打印成功信息。"""
        print(Formatter.success(message))

    @staticmethod
    def print_info(message: str) -> None:
        """打印信息。"""
        print(Formatter.info(message))

    @staticmethod
    def print_table(headers: list[str], rows: list[list[Any]]) -> None:
        """打印表格。

        Args:
            headers: 表头列表
            rows: 行数据列表
        """
        if not headers:
            return

        col_widths = [len(h) for h in headers]
        for row in rows:
            for i, cell in enumerate(row):
                col_widths[i] = max(col_widths[i], len(str(cell)))

        def format_row(cells: list[Any]) -> str:
            return " | ".join(str(cell).ljust(width) for cell, width in zip(cells, col_widths))

        separator = "-+-".join("-" * width for width in col_widths)

        print(Formatter.header(format_row(headers)))
        print(separator)
        for row in rows:
            print(format_row(row))

    @staticmethod
    def format_validation_result(errors: list[dict[str, Any]], detailed: bool = True) -> str:
        """格式化验证结果（CLI 专业格式）。

        Args:
            errors: 错误列表
            detailed: 是否显示详细信息

        Returns:
            格式化的结果字符串
        """
        if not errors:
            return Formatter.success("\n✓ 校验通过，未发现任何错误！\n")

        error_counts = {}
        for error in errors:
            error_type = error.get("error_type", "UnknownError")
            error_counts[error_type] = error_counts.get(error_type, 0) + 1

        lines = []
        lines.append("")
        lines.append(Formatter.colorize("=" * 60, Colors.CYAN))
        lines.append(Formatter.colorize(Formatter.header(" 校验结果汇总 "), Colors.CYAN, Colors.BOLD))
        lines.append(Formatter.colorize("=" * 60, Colors.CYAN))
        lines.append("")

        total_errors = len(errors)
        lines.append(Formatter.header(f"  总计: {total_errors} 个错误"))
        lines.append("")

        if error_counts:
            lines.append(Formatter.header(" 按类型统计:"))
            for error_type, count in sorted(error_counts.items()):
                type_display = error_type.replace("Violation", "").replace("Error", "")
                lines.append(f"   • {type_display}: {count}")
            lines.append("")

        lines.append(Formatter.colorize("-" * 60, Colors.DIM))
        lines.append(Formatter.header(" 详细错误列表 "))
        lines.append(Formatter.colorize("-" * 60, Colors.DIM))
        lines.append("")

        for i, error in enumerate(errors, 1):
            error_type = error.get("error_type", "UnknownError")
            message = error.get("message", "无错误信息")
            table = error.get("table", "")
            column = error.get("column", "")
            row_index = error.get("row_index")
            value = error.get("value")

            type_display = error_type.replace("Violation", "").replace("Error", "")
            type_color = Colors.RED if "Violation" in error_type else Colors.YELLOW

            lines.append(
                Formatter.colorize(f"  [{i}] ", Colors.BOLD)
                + Formatter.colorize(f"【{type_display}】", type_color, Colors.BOLD)
            )

            if table:
                lines.append(f"      表: {Formatter.colorize(table, Colors.CYAN)}")
                if column:
                    lines.append(f"      列: {Formatter.colorize(column, Colors.CYAN)}")
                if row_index is not None:
                    lines.append(f"      行号: {Formatter.colorize(str(row_index), Colors.CYAN)}")
                if value is not None:
                    lines.append(f"      值: {Formatter.colorize(str(value), Colors.YELLOW)}")

            lines.append(f"      {Formatter.colorize('消息:', Colors.DIM)} {message}")
            lines.append("")

        lines.append(Formatter.colorize("=" * 60, Colors.CYAN))

        return "\n".join(lines)

    @staticmethod
    def format_project_info(info: dict[str, Any]) -> str:
        """格式化项目信息。

        Args:
            info: 项目信息字典

        Returns:
            格式化的项目信息
        """
        lines = []
        lines.append(Formatter.header("\n项目信息:"))
        lines.append(f"  名称: {info.get('name', '未命名')}")
        lines.append(f"  路径: {info.get('path', '')}")
        lines.append(f"  Schema 数量: {info.get('schemas_count', 0)}")
        lines.append(f"  约束数量: {info.get('constraints_count', 0)}")

        if info.get("tables"):
            lines.append(Formatter.header("\n数据表:"))
            for table in info["tables"]:
                lines.append(f"  - {table}")

        return "\n".join(lines)
