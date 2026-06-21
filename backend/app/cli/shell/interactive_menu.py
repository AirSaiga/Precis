"""
@fileoverview CLI 交互式菜单模块

功能概述:
- 提供支持方向键导航的终端菜单选择功能
- 支持菜单项高亮、Enter 确认、ESC/0 取消
- 支持带状态信息的菜单显示

架构设计:
- MenuItem 封装菜单项的键、标签和描述
- InteractiveMenu 使用 readchar 捕获键盘输入
- 通过 ANSI 控制码实现菜单的动态渲染与清除
"""

import sys

import readchar


class MenuItem:
    """菜单项"""

    def __init__(self, key: str, label: str, description: str = ""):
        self.key = key  # 用于返回的标识
        self.label = label  # 显示的文本
        self.description = description  # 描述（可选）


class InteractiveMenu:
    """交互式菜单

    支持方向键导航、Enter 确认、ESC/0 取消。

    使用示例:
        menu = InteractiveMenu("请选择操作:")
        menu.add_item("chat", "💬 chat", "进入交互式对话模式")
        menu.add_item("status", "📊 status", "查看 AI 配置状态")
        menu.add_item("switch", "🔄 switch", "切换 AI Provider")
        menu.add_item("help", "❓ help", "显示帮助信息")

        result = menu.show()
        if result:
            print(f"选择了: {result}")
    """

    # ANSI 控制码
    CLEAR_LINE = "\r\033[K"  # 清除当前行（回到行首并清除到行尾）
    MOVE_UP = "\033[{n}A"  # 向上移动 n 行
    HIDE_CURSOR = "\033[?25l"  # 隐藏光标
    SHOW_CURSOR = "\033[?25h"  # 显示光标

    # 颜色代码
    COLOR_RESET = "\033[0m"
    COLOR_HIGHLIGHT = "\033[7m"  # 反色（高亮）
    COLOR_GREEN = "\033[32m"
    COLOR_YELLOW = "\033[33m"
    COLOR_GRAY = "\033[90m"

    def __init__(self, title: str = "", show_cancel: bool = True):
        self.title = title
        self.items: list[MenuItem] = []
        self.show_cancel = show_cancel
        self.selected_index = 0

    def add_item(self, key: str, label: str, description: str = "") -> "InteractiveMenu":
        """添加菜单项"""
        self.items.append(MenuItem(key, label, description))
        return self

    def _get_menu_line_count(self) -> int:
        """计算菜单总行数（用于清除）"""
        count = 0
        if self.title:
            count += 1
        count += len(self.items)
        if self.show_cancel:
            count += 1
        count += 1  # 提示行（虽然是 end="" 但清除时需要处理）
        return count

    def _clear_menu(self) -> None:
        """清除已渲染的菜单"""
        line_count = self._get_menu_line_count()
        sys.stdout.write(self.MOVE_UP.format(n=line_count - 1))
        for i in range(line_count):
            sys.stdout.write(self.CLEAR_LINE)
            if i < line_count - 1:
                sys.stdout.write("\n")
        # 清除后将光标移回第一行起始位置，防止后续渲染时产生空白行堆积
        sys.stdout.write(self.MOVE_UP.format(n=line_count - 1))
        sys.stdout.flush()

    def _render_menu(self) -> None:
        """渲染菜单"""
        # 标题
        if self.title:
            print(f"{self.COLOR_GREEN}{self.title}{self.COLOR_RESET}")

        # 菜单项
        for i, item in enumerate(self.items):
            num = i + 1
            if i == self.selected_index:
                # 高亮当前选中项（反色 + 数字）
                prefix = f"{self.COLOR_HIGHLIGHT} {num}."
                suffix = f"{self.COLOR_RESET}"
            else:
                prefix = f"  {num}."
                suffix = ""

            desc = f" {self.COLOR_GRAY}{item.description}{self.COLOR_RESET}" if item.description else ""
            print(f"{prefix} {item.label}{suffix}{desc}")

        # 取消选项
        if self.show_cancel:
            cancel_idx = len(self.items) + 1
            if self.selected_index == len(self.items):
                prefix = f"{self.COLOR_HIGHLIGHT} {cancel_idx}."
                suffix = f"{self.COLOR_RESET}"
            else:
                prefix = f"  {cancel_idx}."
                suffix = ""
            print(f"{prefix} cancel - 返回{suffix}")

        # 提示（不换行，保持在同一行）
        print(f"{self.COLOR_GRAY}↑/↓ 选择, Enter 确认, ESC/0 取消{self.COLOR_RESET}", end="", flush=True)

    def show(self) -> str | None:
        """
        显示菜单并等待用户选择

        Returns:
            选中项的 key，如果取消则返回 None
        """
        if not self.items:
            return None

        # 隐藏光标
        sys.stdout.write(self.HIDE_CURSOR)
        sys.stdout.flush()

        try:
            # 初始渲染
            self._render_menu()

            while True:
                # 读取单个字符
                key = readchar.readkey()

                # ESC 或 0 取消
                if key in (readchar.key.ESC, "0"):
                    # 清除菜单
                    self._clear_menu()
                    return None

                # Enter 确认
                if key in (readchar.key.ENTER, readchar.key.CR):
                    self._clear_menu()
                    if self.selected_index < len(self.items):
                        return self.items[self.selected_index].key
                    else:
                        return None  # 选择了 cancel

                # 上箭头
                if key == readchar.key.UP:
                    self.selected_index = (self.selected_index - 1) % (len(self.items) + (1 if self.show_cancel else 0))
                    self._clear_menu()
                    self._render_menu()

                # 下箭头
                elif key == readchar.key.DOWN:
                    self.selected_index = (self.selected_index + 1) % (len(self.items) + (1 if self.show_cancel else 0))
                    self._clear_menu()
                    self._render_menu()

                # 数字键直接选择
                elif key.isdigit():
                    num = int(key)
                    if num == 0:
                        self._clear_menu()
                        return None
                    elif 1 <= num <= len(self.items):
                        self._clear_menu()
                        return self.items[num - 1].key

        finally:
            # 确保恢复光标
            sys.stdout.write(self.SHOW_CURSOR)
            sys.stdout.flush()

    def show_with_status(self, status_lines: list[str]) -> str | None:
        """
        显示带状态信息的菜单

        Args:
            status_lines: 状态信息行列表（显示在标题下方）

        Returns:
            选中项的 key，如果取消则返回 None
        """
        if not self.items:
            return None

        # 隐藏光标
        sys.stdout.write(self.HIDE_CURSOR)
        sys.stdout.flush()

        # 保存状态行数（用于清除）
        self._status_line_count = len(status_lines)

        try:
            # 初始渲染
            self._render_menu_with_status(status_lines)

            while True:
                key = readchar.readkey()

                if key in (readchar.key.ESC, "0"):
                    self._clear_menu_with_status(status_lines)
                    return None

                if key in (readchar.key.ENTER, readchar.key.CR):
                    self._clear_menu_with_status(status_lines)
                    if self.selected_index < len(self.items):
                        return self.items[self.selected_index].key
                    else:
                        return None

                if key == readchar.key.UP:
                    self.selected_index = (self.selected_index - 1) % (len(self.items) + (1 if self.show_cancel else 0))
                    self._clear_menu_with_status(status_lines)
                    self._render_menu_with_status(status_lines)

                elif key == readchar.key.DOWN:
                    self.selected_index = (self.selected_index + 1) % (len(self.items) + (1 if self.show_cancel else 0))
                    self._clear_menu_with_status(status_lines)
                    self._render_menu_with_status(status_lines)

                elif key.isdigit():
                    num = int(key)
                    if num == 0:
                        self._clear_menu_with_status(status_lines)
                        return None
                    elif 1 <= num <= len(self.items):
                        self._clear_menu_with_status(status_lines)
                        return self.items[num - 1].key

        finally:
            sys.stdout.write(self.SHOW_CURSOR)
            sys.stdout.flush()

    def _get_menu_with_status_line_count(self, status_lines: list[str]) -> int:
        """计算带状态信息的菜单总行数（用于清除）"""
        count = 0
        if self.title:
            count += 1
        count += len(status_lines)
        count += len(self.items)
        if self.show_cancel:
            count += 1
        count += 1
        return count

    def _render_menu_with_status(self, status_lines: list[str]) -> None:
        """渲染带状态信息的菜单"""
        # 标题
        if self.title:
            print(f"{self.COLOR_GREEN}{self.title}{self.COLOR_RESET}")

        # 状态信息
        for line in status_lines:
            print(line)

        # 菜单项
        for i, item in enumerate(self.items):
            num = i + 1
            if i == self.selected_index:
                prefix = f"{self.COLOR_HIGHLIGHT} {num}."
                suffix = f"{self.COLOR_RESET}"
            else:
                prefix = f"  {num}."
                suffix = ""

            desc = f" {self.COLOR_GRAY}{item.description}{self.COLOR_RESET}" if item.description else ""
            print(f"{prefix} {item.label}{suffix}{desc}")

        # 取消选项
        if self.show_cancel:
            cancel_idx = len(self.items) + 1
            if self.selected_index == len(self.items):
                prefix = f"{self.COLOR_HIGHLIGHT} {cancel_idx}."
                suffix = f"{self.COLOR_RESET}"
            else:
                prefix = f"  {cancel_idx}."
                suffix = ""
            print(f"{prefix} cancel - 返回{suffix}")

        # 提示（不换行）
        print(f"{self.COLOR_GRAY}↑/↓ 选择, Enter 确认, ESC/0 取消{self.COLOR_RESET}", end="", flush=True)

    def _clear_menu_with_status(self, status_lines: list[str]) -> None:
        """清除带状态信息的菜单"""
        line_count = self._get_menu_with_status_line_count(status_lines)
        sys.stdout.write(self.MOVE_UP.format(n=line_count - 1))
        for i in range(line_count):
            sys.stdout.write(self.CLEAR_LINE)
            if i < line_count - 1:
                sys.stdout.write("\n")
        # 清除后将光标移回第一行起始位置，防止后续渲染时产生空白行堆积
        sys.stdout.write(self.MOVE_UP.format(n=line_count - 1))
        sys.stdout.flush()


def show_simple_menu(title: str, options: list[tuple[str, str, str]]) -> str | None:
    """
    快速显示简单菜单

    Args:
        title: 菜单标题
        options: [(key, label, description), ...]

    Returns:
        选中项的 key，如果取消则返回 None

    示例:
        result = show_simple_menu("请选择:", [
            ("a", "选项 A", "这是选项 A"),
            ("b", "选项 B", "这是选项 B"),
        ])
    """
    menu = InteractiveMenu(title)
    for key, label, desc in options:
        menu.add_item(key, label, desc)
    return menu.show()
