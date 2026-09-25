# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 流式 markdown 渲染单元测试

覆盖三层：
1. MarkdownStreamRenderer 纯逻辑状态机：行内样式（标记跨 chunk 拆开）、
   长段落不扣押、标题/分隔线、表格（跨 chunk / 中英文混排对齐 / 分隔行丢弃 /
   列宽截断）、代码围栏（内部不解释 / fence 跨 chunk）、流结束 flush 兜底
2. ChatStreamRenderer pretty 开关接线：强制开 / 强制关（--no-pretty）/
   非 TTY 自动回退 / TTY 自动启用，强制行边界同步（工具行不吞未闭合尾巴），
   final_reply_already_shown 的 raw 比较（渲染不参与）
3. executor / chat 命令接线：pretty 参数透传、--no-pretty flag 解析
"""

from __future__ import annotations

import re
import sys
from collections.abc import AsyncIterator
from io import StringIO
from unittest.mock import MagicMock, patch

from rich.cells import cell_len

from app.cli.shell.commands.ai import executor as executor_mod
from app.cli.shell.commands.ai.chat import AIChatCommand
from app.cli.shell.commands.ai.executor import execute_ai_chat
from app.cli.shell.commands.ai.markdown_stream import MarkdownStreamRenderer
from app.cli.shell.commands.ai.stream_renderer import ChatStreamRenderer
from app.cli.shell.commands.base import CommandResult, ProjectContext
from app.cli.shell.formatter import Colors
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import ChatRequest, StreamChunk
from app.shared.services.llm.providers.fake import FakeProvider

_ANSI_RE = re.compile(r"\033\[[0-9;]*m")


class _ScriptedReplyProvider(FakeProvider):
    """最终回复可定制的 fake 剧本：首轮仍走 tool_calls，收尾轮流式回放指定文本。"""

    def __init__(self, config: AIProvider, final_reply: str) -> None:
        super().__init__(config)
        self._final_reply = final_reply
        self._calls = 0

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        self._calls += 1
        if self._calls >= 2:  # 收尾轮（首轮 tool_calls 已回灌工具结果）
            mid = len(self._final_reply) // 2
            yield StreamChunk(type="delta", text=self._final_reply[:mid])
            yield StreamChunk(type="delta", text=self._final_reply[mid:])
            return
        async for chunk in super().chat_stream(req):
            yield chunk


def _feed_all(md: MarkdownStreamRenderer, chunks: list[str]) -> str:
    """逐 chunk 喂入并拼接全部已渲染输出（含 flush 收尾）。"""
    out = "".join(md.feed(c) for c in chunks)
    return out + md.flush()


def _strip_ansi(text: str) -> str:
    """去掉 ANSI 转义序列，便于对纯文本内容做断言。"""
    return _ANSI_RE.sub("", text)


def _table_rows(text: str) -> list[list[str]]:
    """把渲染后的表格按行拆回单元格（去 ANSI、去首尾竖线、去填充空白）。

    渲染器自产的对齐分隔线（dim 的 |----|----|）与原始 | --- | 行同形，
    均跳过——只保留真实数据行。
    """
    rows = []
    for line in text.splitlines():
        if not _strip_ansi(line).startswith("|"):
            continue
        cells = [c.strip() for c in _strip_ansi(line).strip().strip("|").split("|")]
        non_empty = [c for c in cells if c]
        if non_empty and all(re.fullmatch(r":?-+:?", c) for c in non_empty):
            continue
        rows.append(cells)
    return rows


def _padded_cells(text: str) -> list[list[str]]:
    """拆出保留填充空白的单元格（用于对齐宽度的显示宽度断言）。"""
    cells_per_line = []
    for line in text.splitlines():
        plain = _strip_ansi(line)
        if plain.startswith("|") and set(plain.strip().strip("|")) != {"-"}:
            cells_per_line.append(plain.strip().strip("|").split("|"))
    return cells_per_line


class TestInlineStyles:
    def test_bold_renders_and_markers_removed(self):
        """**粗体** 闭合后带加粗样式输出，标记本身不落屏。"""
        md = MarkdownStreamRenderer()
        out = md.feed("**加粗内容**\n")
        assert out == f"{Colors.BOLD}加粗内容{Colors.RESET}\n"
        assert "**" not in out

    def test_bold_markers_split_across_chunks(self):
        """标记跨 chunk 拆开（['**', 'hel', 'lo**']）仍能正确闭合渲染。"""
        md = MarkdownStreamRenderer()
        out = _feed_all(md, ["**", "hel", "lo**", "\n"])
        assert out == f"{Colors.BOLD}hello{Colors.RESET}\n"

    def test_underscore_bold_renders(self):
        """__下划线粗体__ 同样渲染为加粗。"""
        md = MarkdownStreamRenderer()
        out = md.feed("__下划线粗体__\n")
        assert out == f"{Colors.BOLD}下划线粗体{Colors.RESET}\n"

    def test_inline_code_renders_cyan(self):
        """反引号代码亮色（cyan）输出，标记移除。"""
        md = MarkdownStreamRenderer()
        out = md.feed("详见 `NOT_NULL` 约束\n")
        assert out == f"详见 {Colors.CYAN}NOT_NULL{Colors.RESET} 约束\n"

    def test_inline_code_split_across_chunks(self):
        """反引号代码跨 chunk 拆开仍闭合渲染。"""
        md = MarkdownStreamRenderer()
        out = _feed_all(md, ["配置 ", "`unique", "_idx`", " 已建\n"])
        assert out == f"配置 {Colors.CYAN}unique_idx{Colors.RESET} 已建\n"

    def test_link_text_styled_and_url_dim(self):
        """[文字](url)：文字着色，URL 以 dim 括注保留。"""
        md = MarkdownStreamRenderer()
        out = md.feed("[文档](https://example.com/docs) 参考\n")
        assert out == f"{Colors.CYAN}文档{Colors.RESET}{Colors.DIM} (https://example.com/docs){Colors.RESET} 参考\n"

    def test_link_split_across_chunks(self):
        """链接构造跨 chunk 拆开仍闭合渲染。"""
        md = MarkdownStreamRenderer()
        out = _feed_all(md, ["见 [参", "考", "文档](http://x)", "\n"])
        assert out == f"见 {Colors.CYAN}参考文档{Colors.RESET}{Colors.DIM} (http://x){Colors.RESET}\n"

    def test_plain_text_passthrough_per_chunk(self):
        """无构造的普通文本逐 chunk 全量流出（零暂存）。"""
        md = MarkdownStreamRenderer()
        assert md.feed("普通") == "普通"
        assert md.feed("文本") == "文本"

    def test_bold_after_plain_flows_immediately(self):
        """粗体前的普通文本不等待——开标记之前的内容立即输出。"""
        md = MarkdownStreamRenderer()
        first = md.feed("前面这段很长但应该立刻流出**后")
        assert first == "前面这段很长但应该立刻流出"
        second = md.feed("半**\n")
        assert second == f"{Colors.BOLD}后半{Colors.RESET}\n"


class TestLongParagraphStreaming:
    def test_long_plain_paragraph_flows_per_chunk(self):
        """无换行长文本持续流出：每个 chunk 后输出量与已喂入量相等（无扣押）。"""
        md = MarkdownStreamRenderer()
        fed = ""
        produced = ""
        for _ in range(30):
            chunk = "数据校验0123456789"
            fed += chunk
            produced += md.feed(chunk)
            assert len(produced) == len(fed)

    def test_unclosed_markup_released_after_hold_cap(self):
        """未闭合 ** 超过暂存上限后按字面放行，段落继续流出。"""
        md = MarkdownStreamRenderer(max_markup_hold=8)
        out = md.feed("a**")
        assert out == "a"
        # 8 字符后仍未闭合：** 按字面放行
        out2 = md.feed("12345678")
        assert out2 == "**12345678"
        # 后续文本不再被扣押
        out3 = md.feed("继续流出")
        assert out3 == "继续流出"

    def test_unclosed_link_released_after_hold_cap(self):
        """未闭合 [ 超过链接暂存上限后按字面放行。"""
        md = MarkdownStreamRenderer(max_link_hold=10)
        assert md.feed("[未闭合链接") == ""
        # 超上限后 [ 字面放行，内容继续流出
        out = md.feed("0123456789abcd")
        assert out == "[未闭合链接0123456789abcd"

    def test_trailing_half_marker_held_until_next_chunk(self):
        """行尾单个 * 是半截开标记：暂存到下一 chunk 判定。"""
        md = MarkdownStreamRenderer()
        assert md.feed("hello*") == "hello"
        assert md.feed("*world**") == f"{Colors.BOLD}world{Colors.RESET}"


class TestHeadings:
    def test_heading_renders_bold_cyan_without_hash(self):
        """标题去 # 前缀，加粗+着色，行尾收样式。"""
        md = MarkdownStreamRenderer()
        out = md.feed("## 校验结果\n")
        assert out == f"{Colors.BOLD}{Colors.CYAN}校验结果{Colors.RESET}\n"

    def test_heading_hash_split_across_chunks(self):
        """# 前缀跨 chunk 拆开仍能识别标题。"""
        md = MarkdownStreamRenderer()
        out = _feed_all(md, ["#", "# ", "标题", "内", "容", "\n"])
        assert out == f"{Colors.BOLD}{Colors.CYAN}标题内容{Colors.RESET}\n"

    def test_all_heading_levels_render(self):
        """1-6 级标题均渲染，7 个 # 不是标题。"""
        md = MarkdownStreamRenderer()
        for level in range(1, 7):
            out = md.feed("#" * level + " 标题\n")
            assert out == f"{Colors.BOLD}{Colors.CYAN}标题{Colors.RESET}\n"
        # 第 7 个 # 时不构成标题，按普通文本
        out = md.feed("####### 不是标题\n")
        assert _strip_ansi(out) == "####### 不是标题\n"

    def test_hash_without_space_is_plain_text(self):
        """# 后无空格（#hashtag）不构成标题，原文直出。"""
        md = MarkdownStreamRenderer()
        out = md.feed("#hashtag\n")
        assert out == "#hashtag\n"


class TestSeparators:
    def test_dashes_separator_renders_dim_rule(self):
        """--- 整行渲染为 dim 的 ─ 横线。"""
        md = MarkdownStreamRenderer()
        out = md.feed("---\n")
        assert out == f"{Colors.DIM}{'─' * 40}{Colors.RESET}\n"

    def test_asterisk_and_underscore_separators(self):
        """*** / ___ 同样识别为分隔线。"""
        md = MarkdownStreamRenderer()
        assert md.feed("***\n") == f"{Colors.DIM}{'─' * 40}{Colors.RESET}\n"
        assert md.feed("___\n") == f"{Colors.DIM}{'─' * 40}{Colors.RESET}\n"

    def test_double_dash_stays_literal(self):
        """不足 3 个标记符的行不是分隔线，原文直出。"""
        md = MarkdownStreamRenderer()
        assert md.feed("--\n") == "--\n"
        assert md.feed("- 列表项原文\n") == "- 列表项原文\n"

    def test_separator_split_across_chunks(self):
        """分隔线字符跨 chunk 拆开仍识别。"""
        md = MarkdownStreamRenderer()
        out = _feed_all(md, ["-", "-", "-", "\n"])
        assert out == f"{Colors.DIM}{'─' * 40}{Colors.RESET}\n"


class TestTables:
    def test_table_separator_dropped_and_columns_aligned(self):
        """表格重排：分隔行丢弃、列对齐、表头加粗。"""
        md = MarkdownStreamRenderer()
        out = md.feed("| 列名 | 类型 |\n| --- | --- |\n| id | integer |\n| nickname | string |\n\n")
        plain = _strip_ansi(out)
        assert "| --- |" not in plain  # 原始分隔行被丢弃
        rows = _table_rows(out)
        assert rows == [["列名", "类型"], ["id", "integer"], ["nickname", "string"]]
        # 数据行按显示宽度对齐：每行（含边距与 dim 对齐线）显示宽度一致
        line_widths = {cell_len(_strip_ansi(line)) for line in out.splitlines() if _strip_ansi(line).startswith("|")}
        assert line_widths == {22}  # 2 边距 + 8 列宽 + 3 分隔 + 7 列宽 + 2 边距
        # 表头行加粗
        assert Colors.BOLD in out
        # 表格后空行分隔，后续内容不粘连
        assert plain.endswith("\n\n")

    def test_table_streamed_across_chunks(self):
        """表格行跨 chunk 拆开仍缓冲成块并正确重排。"""
        md = MarkdownStreamRenderer()
        chunks = ["| a | b |\n", "| ---", " | --- |\n", "| 1 ", "| 2 |\n", "\n"]
        out = "".join(md.feed(c) for c in chunks) + md.feed("")
        plain = _strip_ansi(out)
        assert "| --- |" not in plain
        rows = _table_rows(out)
        assert rows[0] == ["a", "b"]
        assert rows[1] == ["1", "2"]

    def test_table_cjk_mixed_width_alignment(self):
        """中英文混排：按显示宽度（cell_len）而非字符数对齐。"""
        md = MarkdownStreamRenderer()
        out = md.feed("| 名称 | 值 |\n| --- | --- |\n| 昵称 | abc |\n| nickname | 123456 |\n\n")
        cells_per_line = _padded_cells(out)
        # 各列单元格（含两侧边距空格）的显示宽度全等（全角中文按 2 计）
        col0_widths = {cell_len(cells[0]) for cells in cells_per_line}
        col1_widths = {cell_len(cells[1]) for cells in cells_per_line}
        assert col0_widths == {10}  # 列宽 8（max("名称"=4, "昵称"=4, "nickname"=8)）+ 2 边距
        assert col1_widths == {8}  # 列宽 6（max("值"=2, "abc"=3, "123456"=6)）+ 2 边距

    def test_table_col_width_truncated(self):
        """超宽单元格按显示宽度截断并补省略号。"""
        md = MarkdownStreamRenderer(table_col_max=6)
        out = md.feed("| 很长的单元格内容 | 短 |\n| --- | --- |\n| abcdefghij | x |\n\n")
        plain = _strip_ansi(out)
        for row in _table_rows(out):
            for cell in row:
                assert cell_len(cell) <= 6
        assert "…" in plain

    def test_table_flushed_when_non_table_line_arrives(self):
        """非 | 开头的行触发表格块冲刷，该行内容随后正常渲染。"""
        md = MarkdownStreamRenderer()
        out = md.feed("| a | b |\n| --- | --- |\n| 1 | 2 |\n总结：共 2 列\n")
        plain = _strip_ansi(out)
        assert plain.index("| 1") < plain.index("总结")  # 表格先于后续文本
        assert "总结：共 2 列" in plain


class TestCodeFences:
    def test_fence_content_dim_not_inline_interpreted(self):
        """围栏内 ** 不做行内解释，整块 dim 缩进输出。"""
        md = MarkdownStreamRenderer()
        out = md.feed("```python\nx = **1**  # 字面\n```\n")
        assert out == f"{Colors.DIM}  x = **1**  # 字面{Colors.RESET}\n"

    def test_fence_split_across_chunks(self):
        """fence 标记跨 chunk 拆开（['``', '`py'...]）仍正确开关围栏。"""
        md = MarkdownStreamRenderer()
        out = _feed_all(md, ["``", "`py", "thon\n", "code\n", "``", "`\n", "之后\n"])
        assert out == f"{Colors.DIM}  code{Colors.RESET}\n之后\n"

    def test_fence_info_string_dropped(self):
        """开围栏的语言标记（python）不落屏。"""
        md = MarkdownStreamRenderer()
        out = md.feed("```python\nprint(1)\n```\n")
        assert "python" not in out
        assert "print(1)" in _strip_ansi(out)

    def test_unterminated_fence_flushed_at_stream_end(self):
        """流结束时未闭合围栏：已缓冲代码行照常 dim 输出。"""
        md = MarkdownStreamRenderer()
        md.feed("```\n未闭合的代码\n")
        assert md.feed("仍在围栏内") == ""  # 围栏内缓冲
        tail = md.flush()
        assert tail == f"{Colors.DIM}  未闭合的代码{Colors.RESET}\n{Colors.DIM}  仍在围栏内{Colors.RESET}\n"

    def test_fence_line_starting_with_backtick_is_content(self):
        """围栏内以反引号开头但不足 3 个的行是代码内容，不是关闭围栏。"""
        md = MarkdownStreamRenderer()
        out = md.feed("```\n`tick` 标记\n```\n")
        assert _strip_ansi(out) == "  `tick` 标记\n"


class TestFlushAndBoundaries:
    def test_flush_releases_unclosed_bold_as_raw(self):
        """流结束 flush：未闭合 ** 按原文输出兜底。"""
        md = MarkdownStreamRenderer()
        assert md.feed("说明**未闭合") == "说明"
        assert md.flush() == "**未闭合"

    def test_flush_closes_open_heading_style(self):
        """流结束 flush：未换行的标题收样式（不带换行，由上层收尾）。"""
        md = MarkdownStreamRenderer()
        assert md.feed("## 未完标题") == f"{Colors.BOLD}{Colors.CYAN}未完标题"
        assert md.flush() == Colors.RESET

    def test_flush_releases_partial_line_start_prefix(self):
        """流结束 flush：行首未成形前缀（#/``/单个-）按原文放行。"""
        md = MarkdownStreamRenderer()
        assert md.feed("#") == ""
        assert md.flush() == "#"

        md2 = MarkdownStreamRenderer()
        assert md2.feed("-") == ""
        assert md2.flush() == "-"

    def test_newline_releases_held_tail_for_boundary(self):
        """newline()（工具行/轮次分隔边界）：未闭合尾巴按原文放出，状态复位。"""
        md = MarkdownStreamRenderer()
        assert md.feed("说明**加粗") == "说明"
        assert md.newline() == "**加粗"
        # 边界后状态回到行首：新文本仍可识别标题
        assert md.feed("## 新标题\n") == f"{Colors.BOLD}{Colors.CYAN}新标题{Colors.RESET}\n"

    def test_newline_completes_partial_separator_as_raw(self):
        """newline() 边界上未成形的分隔线前缀按原文放行。"""
        md = MarkdownStreamRenderer()
        assert md.feed("---") == ""
        assert md.newline() == "---"


class TestChatStreamRendererPrettySwitch:
    def test_pretty_disabled_passthrough_raw(self, capsys):
        """--no-pretty：markdown 原文透传（标记、围栏原样）。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=True, pretty=False)
        renderer.on_chunk("**加粗** 和 `代码`")
        renderer.finish()
        assert capsys.readouterr().out == "**加粗** 和 `代码`\n"

    def test_non_tty_auto_falls_back_to_passthrough(self, capsys):
        """默认（None）+ 非 TTY（capsys 捕获流）：自动回退原文直出。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=True)
        renderer.on_chunk("**加粗**")
        renderer.finish()
        assert capsys.readouterr().out == "**加粗**\n"

    def test_pretty_enabled_renders_markdown(self, capsys):
        """pretty=True：markdown 渲染为 ANSI 样式。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=True, pretty=True)
        renderer.on_chunk("**加粗**\n")
        renderer.finish()
        out = capsys.readouterr().out
        assert out == f"{Colors.BOLD}加粗{Colors.RESET}\n"
        assert "**" not in out

    def test_pretty_auto_enabled_for_tty(self, monkeypatch):
        """默认（None）+ stdout 为 TTY：自动启用 markdown 渲染。"""

        class _TtyStringIO(StringIO):
            def isatty(self) -> bool:
                return True

        fake_stdout = _TtyStringIO()
        monkeypatch.setattr(sys, "stdout", fake_stdout)
        renderer = ChatStreamRenderer(spinner=None, interactive=True)
        renderer.on_chunk("**加粗**")
        renderer.finish()
        assert fake_stdout.getvalue() == f"{Colors.BOLD}加粗{Colors.RESET}\n"

    def test_finish_flushes_pending_tail_with_pretty(self, capsys):
        """pretty 路径 finish：未闭合构造按原文兜底输出并收尾换行。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=True, pretty=True)
        renderer.on_chunk("结尾未闭合**尾巴")
        renderer.finish()
        assert capsys.readouterr().out == "结尾未闭合**尾巴\n"

    def test_tool_call_boundary_releases_held_tail(self, capsys):
        """工具行边界：未闭合尾巴先按原文放出再换行，不被工具行截胡。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=True, pretty=True)
        renderer.on_chunk("说明**加粗")
        first = capsys.readouterr().out
        assert first == "说明"  # 尾巴暂存中
        renderer.on_tool_call("read_project", "call_1", 1)
        second = capsys.readouterr().out
        assert second.startswith("**加粗\n")  # 尾巴原文先于换行放出
        assert "→ 调用工具 读取项目..." in second

    def test_final_reply_comparison_uses_raw_text_with_pretty(self, capsys):
        """final_reply_already_shown 比较 raw 原文，渲染输出不影响判定。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=True, pretty=True)
        renderer.on_chunk("**加粗**正文")
        capsys.readouterr()
        assert renderer.final_reply_already_shown("**加粗**正文") is True
        assert renderer.final_reply_already_shown("加粗正文") is False

    def test_pretty_keeps_unclosed_hold_bounded_across_chunks(self, capsys):
        """pretty 路径长段落流式手感：每个 chunk 都有产出，仅小尾巴暂存。"""
        renderer = ChatStreamRenderer(spinner=None, interactive=True, pretty=True)
        produced = 0
        for i in range(20):
            renderer.on_chunk("普通段落内容0123456789")
            produced += len(capsys.readouterr().out)
        assert produced >= 20 * 10 - 8  # 扣押不超过行尾半截标记


class TestExecuteAIChatPrettyEndToEnd:
    def test_interactive_pretty_stream_renders_markdown(self, tmp_path, capsys, monkeypatch):
        """ai chat + pretty 强制开：含 markdown 的流式回复被渲染（标记不落屏），回复不重复。"""
        _make_fake_project(tmp_path)
        spinner_stub = MagicMock()
        monkeypatch.setattr(executor_mod, "SpinnerController", lambda: spinner_stub)
        monkeypatch.setattr("builtins.input", lambda *a, **k: "y")

        reply = "## 已完成\n**users.nickname** 已加 `chinese_mixed` 约束。\n"
        provider = _ScriptedReplyProvider(_fake_provider_config(), reply)
        with (
            patch.object(executor_mod, "_get_provider_display", return_value={"id": "x"}),
            patch.object(executor_mod, "_get_provider_with_key", return_value=_fake_provider_config()),
            patch.object(executor_mod, "resolve_context_window", return_value=32000),
            patch("app.shared.services.llm.providers.create", return_value=provider),
            patch(
                "app.cli.shell.commands.ai.interaction.build_context_data",
                return_value={"context": {"selectedNodes": []}},
            ),
        ):
            result = execute_ai_chat("给昵称加字符集约束", _make_context(tmp_path), interactive=True, pretty=True)

        captured = capsys.readouterr()
        assert result.success
        assert result.data["reply"] == reply
        # markdown 标记被渲染：## 与 ** 不落屏，标题/粗体带 ANSI
        assert "##" not in captured.out
        assert "**" not in captured.out
        assert f"{Colors.BOLD}{Colors.CYAN}已完成{Colors.RESET}" in captured.out
        assert f"{Colors.BOLD}users.nickname{Colors.RESET}" in captured.out
        assert f"{Colors.CYAN}chinese_mixed{Colors.RESET}" in captured.out
        # 渲染输出不参与 reply 去重判定：raw 比较仍成立（由 non-tty 用例覆盖），
        # 此处确认最终回复未被整段重复打印
        assert captured.out.count("chinese_mixed") == 1


class TestExecutorAndChatWiring:
    def test_execute_ai_chat_forwards_pretty_to_renderer(self, tmp_path, monkeypatch):
        """execute_ai_chat 的 pretty 参数透传到 ChatStreamRenderer。"""
        spinner_stub = MagicMock()
        monkeypatch.setattr(executor_mod, "SpinnerController", lambda: spinner_stub)
        renderer_cls = MagicMock()
        monkeypatch.setattr(executor_mod, "ChatStreamRenderer", renderer_cls)

        fake_result = MagicMock()
        fake_result.success = True
        fake_result.reply = "好的"
        fake_result.actions = []
        fake_result.frontend_instructions = None
        fake_result.tool_steps = []
        orch = MagicMock()
        orch.execute_chat = MagicMock(return_value=fake_result)

        with (
            patch.object(executor_mod, "_get_provider_display", return_value={"id": "x"}),
            patch.object(executor_mod, "_get_provider_with_key", return_value={"id": "x", "api_key": "k"}),
            patch.object(executor_mod, "resolve_context_window", return_value=32000),
            patch.object(executor_mod, "AIChatOrchestrator", return_value=orch),
            patch(
                "app.cli.shell.commands.ai.interaction.build_context_data",
                return_value={"context": {"selectedNodes": []}},
            ),
            patch("asyncio.run", return_value=fake_result),
        ):
            result = execute_ai_chat("加约束", _make_context(tmp_path), interactive=True, agent_mode=True, pretty=False)

        assert result.success
        renderer_cls.assert_called_once_with(spinner=spinner_stub, interactive=True, pretty=False)

    def test_chat_command_no_pretty_flag_parsed_and_forwarded(self, tmp_path, monkeypatch, capsys):
        """ai chat --no-pretty：flag 解析为 pretty=False 并透传给 execute_ai_chat。"""
        cmd = AIChatCommand()
        # 显式 context_window 避免触发 provider registry 探测
        provider = MagicMock()
        provider.name = "p"
        provider.model = "m"
        provider.context_window = 32000
        monkeypatch.setattr(cmd._cli_config, "get_active_provider", lambda: provider)

        captured: dict[str, object] = {}

        def fake_execute(message, context, *, interactive=False, history=None, agent_mode=True, pretty=None):
            captured["pretty"] = pretty
            captured["agent_mode"] = agent_mode
            return CommandResult.ok("", data=None)

        monkeypatch.setattr("app.cli.shell.commands.ai.chat.execute_ai_chat", fake_execute)

        answers = iter(["加个约束"])

        def fake_input(prompt=""):
            try:
                return next(answers)
            except StopIteration:
                raise EOFError from None

        monkeypatch.setattr("builtins.input", fake_input)

        result = cmd.execute(["--no-pretty"], _make_context(tmp_path))
        assert result.success
        assert captured["pretty"] is False
        assert captured["agent_mode"] is True
        assert "--no-pretty" in cmd.usage

    def test_chat_command_default_pretty_is_auto(self, tmp_path, monkeypatch):
        """ai chat（无 flag）：pretty=None（自动 TTY 检测）透传。"""
        cmd = AIChatCommand()
        provider = MagicMock()
        provider.name = "p"
        provider.model = "m"
        provider.context_window = 32000
        monkeypatch.setattr(cmd._cli_config, "get_active_provider", lambda: provider)

        captured: dict[str, object] = {}

        def fake_execute(message, context, *, interactive=False, history=None, agent_mode=True, pretty=None):
            captured["pretty"] = pretty
            return CommandResult.ok("", data=None)

        monkeypatch.setattr("app.cli.shell.commands.ai.chat.execute_ai_chat", fake_execute)

        answers = iter(["问一下"])

        def one_input_then_eof(prompt=""):
            try:
                return next(answers)
            except StopIteration:
                raise EOFError from None

        monkeypatch.setattr("builtins.input", one_input_then_eof)

        result = cmd.execute([], _make_context(tmp_path))
        assert result.success
        assert captured["pretty"] is None

    def test_chat_command_unknown_flag_rejected(self, tmp_path, monkeypatch):
        """未知 flag 仍走既有参数校验报错路径。"""
        cmd = AIChatCommand()
        provider = MagicMock()
        provider.name = "p"
        provider.model = "m"
        provider.context_window = 32000
        monkeypatch.setattr(cmd._cli_config, "get_active_provider", lambda: provider)

        result = cmd.execute(["--bogus"], _make_context(tmp_path))
        assert not result.success
        assert "未知参数" in result.message


def _make_context(tmp_path) -> ProjectContext:
    ctx = ProjectContext()
    ctx.project_path = str(tmp_path)
    ctx.project_config = {"project": {"name": "P", "id": "p"}}
    return ctx


def _fake_provider_config() -> AIProvider:
    return AIProvider(
        id="fake-md-stream",
        name="fake-md-stream",
        type=ProviderType.FAKE,
        base_url="http://localhost/fake",
        api_key="fake-key",
        model="fake-1",
    )


def _make_fake_project(tmp_path) -> None:
    """最小 V2 项目（users 表 + 数据文件），让 fake 剧本的 apply_actions 成功写盘。"""
    (tmp_path / "schemas").mkdir(exist_ok=True)
    (tmp_path / "constraints").mkdir(exist_ok=True)
    (tmp_path / "data").mkdir(exist_ok=True)
    (tmp_path / "project.precis.yaml").write_text(
        "\n".join(
            [
                "version: 2",
                "project:",
                "  id: fake-md-stream-test",
                "  name: fake-md-stream-test",
                "schemas:",
                "  - id: users",
                "    path: schemas/users.schema.yaml",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (tmp_path / "schemas" / "users.schema.yaml").write_text(
        "\n".join(
            [
                "version: 2",
                "id: users",
                "name: users",
                "source:",
                "  mode: relative_file",
                "  path: data/users.csv",
                "columns:",
                "  - id: id",
                "    name: id",
                "    type: integer",
                "    primary_key: true",
                "    nullable: false",
                "  - id: name",
                "    name: name",
                "    type: string",
                "  - id: nickname",
                "    name: nickname",
                "    type: string",
                "constraints: []",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (tmp_path / "data" / "users.csv").write_text("id,name,nickname\n1,张三,小明\n2,李四,阿杰88\n", encoding="utf-8")
