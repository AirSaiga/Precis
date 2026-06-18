# backend/tests/unit/test_completer.py
"""
@fileoverview CLI Shell Tab 补全模块单元测试

测试范围:
- _compute_candidates: 顶层命令/子命令补全候选计算（纯逻辑，不依赖真实终端）
- _filter_and_decorate: 候选过滤与尾部空格装饰
- install_readline_completer: 安装函数返回 bool，不抛异常
- _wrap_ansi_for_readline (在 main.py): ANSI 包裹逻辑

测试策略:
- 用真实的 CLIShell().registry 作为补全数据源（已有测试证明可安全构造）
- mock readline 后端的 get_line_buffer，避免依赖真实终端输入
- 不调用真实 input()/readkey()，测试不会阻塞
"""

from __future__ import annotations

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.cli.shell.completer import (  # noqa: E402
    _compute_candidates,
    _filter_and_decorate,
    install_readline_completer,
)
from app.cli.shell.main import CLIShell, _wrap_ansi_for_readline  # noqa: E402


def _make_registry():
    """构造真实命令注册表（复用 CLIShell 的内置命令注册）。"""
    shell = CLIShell()
    return shell.registry


class _FakeReadline:
    """模拟 readline 后端，仅实现补全测试需要的 get_line_buffer。"""

    def __init__(self, line_buffer: str):
        self._buffer = line_buffer

    def get_line_buffer(self) -> str:
        return self._buffer


class TestComputeCandidates:
    """_compute_candidates 两层补全逻辑测试。"""

    def test_top_level_command_prefix(self):
        """输入 val 时应补全到 validate。"""
        registry = _make_registry()
        rl = _FakeReadline("val")
        result = _compute_candidates(registry, rl, "val")
        assert "validate " in result
        assert len(result) >= 1

    def test_top_level_alias(self):
        """输入 che 时应补全到 check（validate 的别名）。"""
        registry = _make_registry()
        rl = _FakeReadline("che")
        result = _compute_candidates(registry, rl, "che")
        assert "check " in result

    def test_subcommand_when_command_present(self):
        """输入 'project o' 时应补全到 open（project 有子命令）。"""
        registry = _make_registry()
        rl = _FakeReadline("project o")
        result = _compute_candidates(registry, rl, "o")
        assert "open " in result
        # 应包含 project 的全部子命令前缀为 o 的项
        assert all(c.startswith("o") for c in result)

    def test_subcommand_lists_all_when_empty_text(self):
        """'project ' + 空 text 应列出全部子命令。"""
        registry = _make_registry()
        rl = _FakeReadline("project ")
        result = _compute_candidates(registry, rl, "")
        # project 子命令: open/status/history（及其别名）
        names = [c.strip() for c in result]
        assert "open" in names
        assert "status" in names
        assert "history" in names

    def test_returns_empty_for_command_without_subcommands(self):
        """validate 无子命令，输入第二词时不应补全。"""
        registry = _make_registry()
        rl = _FakeReadline("validate use")
        result = _compute_candidates(registry, rl, "use")
        assert result == []

    def test_returns_empty_after_third_word(self):
        """已输入到第三词及以后时不再补全子命令。"""
        registry = _make_registry()
        # 'project open extra' → 第三个词，不补全
        rl = _FakeReadline("project open ext")
        result = _compute_candidates(registry, rl, "ext")
        assert result == []

    def test_top_level_empty_text_lists_all_commands(self):
        """空 text 时应列出所有顶层命令（readline 列出全部行为）。"""
        registry = _make_registry()
        rl = _FakeReadline("")
        result = _compute_candidates(registry, rl, "")
        names = [c.strip() for c in result]
        # 内置命令应都在候选中
        assert "help" in names
        assert "open" in names
        assert "validate" in names
        assert "exit" in names

    def test_top_level_no_match_returns_empty(self):
        """无任何命令以该前缀开头时返回空列表。"""
        registry = _make_registry()
        rl = _FakeReadline("zzzzz")
        result = _compute_candidates(registry, rl, "zzzzz")
        assert result == []

    def test_get_line_buffer_failure_falls_back_to_top_level(self):
        """get_line_buffer 抛异常时退化为用 text 做顶层补全，不崩溃。"""
        registry = _make_registry()

        class _BrokenReadline:
            def get_line_buffer(self):
                raise RuntimeError("unavailable")

        result = _compute_candidates(registry, _BrokenReadline(), "val")
        # 应回退到顶层补全，仍能匹配 validate
        assert "validate " in result


class TestFilterAndDecorate:
    """_filter_and_decorate 候选处理测试。"""

    def test_filters_by_prefix(self):
        """仅保留以 text 开头的候选。"""
        result = _filter_and_decorate(["validate", "open", "exit"], "v")
        assert result == ["validate "]

    def test_decorates_with_trailing_space(self):
        """有 text 前缀时，匹配候选追加尾部空格。"""
        result = _filter_and_decorate(["open", "close"], "op")
        assert result == ["open "]

    def test_empty_text_no_trailing_space(self):
        """text 为空时不追加空格（readline 列出全部时不应每项带空格）。"""
        result = _filter_and_decorate(["open", "close"], "")
        assert result == ["close", "open"]  # 排序后

    def test_dedup(self):
        """重复候选应去重。"""
        result = _filter_and_decorate(["open", "open", "open"], "op")
        assert result == ["open "]

    def test_sorted(self):
        """结果应按字典序排序。"""
        result = _filter_and_decorate(["zebra", "apple", "mango"], "")
        assert result == ["apple", "mango", "zebra"]


class TestInstallReadlineCompleter:
    """install_readline_completer 安装函数测试。"""

    def test_returns_bool_without_raising(self):
        """安装函数应返回 bool 且不抛异常（环境无 readline 时返回 False）。"""
        registry = _make_registry()
        result = install_readline_completer(registry)
        assert isinstance(result, bool)


class TestWrapAnsiForReadline:
    """_wrap_ansi_for_readline ANSI 包裹测试（main.py）。"""

    def test_wraps_single_ansi_sequence(self):
        prompt = "\x1b[36mprecis> \x1b[0m"
        result = _wrap_ansi_for_readline(prompt)
        assert "\x01\x1b[36m\x02" in result
        assert "\x01\x1b[0m\x02" in result
        # 原始可见文本不变
        assert "precis> " in result

    def test_plain_prompt_unchanged(self):
        """无 ANSI 的纯文本 prompt 应原样返回。"""
        prompt = "precis> "
        assert _wrap_ansi_for_readline(prompt) == "precis> "

    def test_preserves_text_between_sequences(self):
        prompt = "\x1b[36mhello\x1b[0m \x1b[31mworld\x1b[0m"
        result = _wrap_ansi_for_readline(prompt)
        assert "hello" in result
        assert "world" in result
        # 两个序列都被包裹
        assert result.count("\x01") == 4  # 4 个序列各一对
