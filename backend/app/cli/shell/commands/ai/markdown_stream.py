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
# WITHOUT WARRANTIES OR ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# backend/app/cli/shell/commands/ai/markdown_stream.py
"""
@fileoverview 流式 markdown → 终端 ANSI 渲染状态机（纯逻辑，无 I/O）

功能概述:
- 把 LLM 流式输出的 markdown 逐 chunk 渲染为带 ANSI 样式的终端文本：
  标题加粗着色、**/__ 粗体、反引号代码亮色、[text](url) 链接着色、
  表格缓冲后按显示宽度对齐重排（丢 |---| 分隔行）、代码围栏整块 dim 缩进、
  ---/***/___ 分隔线渲染为 dim 横线
- 保持流式手感：普通段落只暂存"未闭合行内构造"的尾巴（有上限），
  闭合即出；超上限按字面放行——段落再长也不会被整体扣押
- 块级元素（表格/代码围栏）按 markdown 语义整块缓冲，块结束一次性输出

设计约束（见 ChatStreamRenderer 模块注释的终端并发纪律）:
- 本模块不做任何打印、不碰 spinner，只做 chunk → 已渲染文本片段的纯映射；
  上层经 _print_to 输出，编码兜底与 spinner 停启纪律由上层统一维护
- 不引入 rich.Live（全屏重绘会与 spinner 线程产生新的终端并发写竞态），
  仅用 rich.cells.cell_len 处理中英文混排显示宽度

状态机:
    LINE_START ─┬─ "#{1,6} " → HEADING（流式直出，行尾收样式）
                ├─ "|"       → TABLE_ROW（整行缓冲，块结束重排）
                ├─ "```"    → CODE（整块缓冲 dim 输出，内部不做行内解释）
                ├─ 标记符行尾判定 → 分隔线
                └─ 其余      → TEXT（行内扫描：**/__/`/[..](..) 开闭跟踪）
    TEXT 内部用尾巴暂存（_pending）实现跨 chunk 的标记闭合跟踪；
    newline() 供上层在工具行/轮次分隔等强制行边界处同步状态机。

输入示例:
    md = MarkdownStreamRenderer()
    out = md.feed("## 标题\\n**加粗** 和 `代码`\\n")

输出示例:
    "\\033[1m\\033[36m标题\\033[0m\\n\\033[1m加粗\\033[0m 和 \\033[36m代码\\033[0m\\n"
"""

from __future__ import annotations

import enum
import re

from rich.cells import cell_len

from app.cli.shell.formatter import Colors, Formatter

# 行内构造（**/__/`）闭合暂存上限：超过即视为字面文本放行，保证长段落持续流出
_MAX_MARKUP_HOLD = 48
# 链接 [text](url) 闭合暂存上限：URL 合法长度远超普通标记，单独放宽
_MAX_LINK_HOLD = 200
# 表格单列显示宽度上限（含截断省略号），超出按显示宽度截断防刷屏
_TABLE_COL_MAX = 30
# 分隔线渲染宽度（dim 的 ─ 横线）
_RULE_WIDTH = 40
# 行首纯标记符（-/*/_) 连续长度上限：防病态长标记行被无限扣押
_MAX_MARKER_RUN = 200

# 表格分隔行单元格（| :--- | ---: | 形态）
_SEPARATOR_CELL_RE = re.compile(r"^:?-+:?$")


class _State(enum.Enum):
    """流式渲染状态机的顶层状态。"""

    LINE_START = "line_start"  # 行首：暂存少量字符做行类型分类
    TEXT = "text"  # 普通行：行内构造开闭跟踪，尾巴暂存
    HEADING = "heading"  # 标题：样式已开启，正文流式直出
    TABLE_ROW = "table_row"  # 表格行：整行缓冲待块结束重排
    CODE = "code"  # 代码围栏：整块缓冲 dim 输出


class _CodeState(enum.Enum):
    """代码围栏块内部的子状态。"""

    INFO = "info"  # 开围栏行：丢弃语言标记直至行尾
    LINE_HEAD = "line_head"  # 代码行行首：判定是否关闭围栏（```）
    IN_LINE = "in_line"  # 代码行内容：缓冲直至行尾
    DROPPING_FENCE_END = "dropping_fence_end"  # 关闭围栏行：丢弃剩余字符


class MarkdownStreamRenderer:
    """流式 markdown 渲染状态机（纯逻辑）。

    输入为流式 chunk（feed），输出为应立即打印的已渲染文本片段（含 ANSI 与换行）。
    流结束（或上层强制行边界）时调用 flush()/newline() 收尾暂存内容。

    Attributes:
        _max_markup_hold: 行内标记闭合暂存上限
        _max_link_hold: 链接闭合暂存上限
        _table_col_max: 表格单列显示宽度上限
        _state: 顶层状态
        _code_state: 围栏块子状态
        _line_head: 行首待分类前缀 / 表格行与代码行的当前行缓冲
        _pending: 普通行未消费尾巴（行内构造开闭跟踪的暂存区）
        _table_rows: 已缓冲的表格行（含开头的 |）
        _code_lines: 已缓冲的代码行
    """

    def __init__(
        self,
        *,
        max_markup_hold: int = _MAX_MARKUP_HOLD,
        max_link_hold: int = _MAX_LINK_HOLD,
        table_col_max: int = _TABLE_COL_MAX,
    ) -> None:
        self._max_markup_hold = max_markup_hold
        self._max_link_hold = max_link_hold
        self._table_col_max = table_col_max
        self._state = _State.LINE_START
        self._code_state = _CodeState.LINE_HEAD
        self._line_head = ""
        self._pending = ""
        self._table_rows: list[str] = []
        self._code_lines: list[str] = []

    # ------------------------------------------------------------------ 对外接口

    def feed(self, text: str) -> str:
        """喂入一个流式 chunk，返回本次可打印的已渲染文本（可为空串）。"""
        out: list[str] = []
        for ch in text:
            self._feed_char(ch, out)
        return "".join(out)

    def newline(self) -> str:
        """强制行边界（工具行/轮次分隔前）：同步状态机到行首。

        上层在终端补打换行（该换行不由本模块输出），调用本方法保证：
        - 未闭合行内尾巴按原文放出（不被后续工具行截胡）
        - 行首分类状态复位，后续文本仍能正确识别标题等行类型
        返回需在换行前补打印的文本（可为空串）。
        """
        out: list[str] = []
        if self._state is _State.LINE_START:
            if self._line_head:
                # 分类未完成的行首前缀按原文放行（未成形分隔线/标题等）
                self._pending = self._line_head
                self._line_head = ""
                out.append(self._drain_inline())
                out.append(self._release_inline())
        elif self._state is _State.TEXT:
            out.append(self._release_inline())
            self._state = _State.LINE_START
        elif self._state is _State.HEADING:
            out.append(Colors.RESET)
            self._state = _State.LINE_START
        elif self._state is _State.TABLE_ROW:
            # 表格行被边界截断：并入缓冲，保留待块结束统一重排
            self._table_rows.append(self._line_head)
            self._line_head = ""
            self._state = _State.LINE_START
        elif self._state is _State.CODE and self._code_state is _CodeState.IN_LINE:
            # 代码块跨边界保留状态：当前行并入缓冲即可
            self._code_lines.append(self._line_head)
            self._line_head = ""
            self._code_state = _CodeState.LINE_HEAD
        return "".join(out)

    def flush(self) -> str:
        """流结束：冲刷全部暂存（未闭合构造按原文兜底输出）。"""
        out: list[str] = []
        if self._state is _State.LINE_START:
            head = self._line_head
            self._line_head = ""
            if head:
                if head[0] in "-*_" and len(set(head)) == 1 and len(head) >= 3:
                    # 行尾未到但流已结束的完整分隔线
                    out.append(Formatter.dim("─" * _RULE_WIDTH) + "\n")
                elif head.startswith("|"):
                    # 未换行的表格行：并入缓冲一起重排
                    self._table_rows.append(head)
                    out.append(self._flush_table())
                else:
                    # 未成形的行首前缀（#/``/普通文本）按原文放行
                    self._pending = head
                    out.append(self._drain_inline())
                    out.append(self._release_inline())
        elif self._state is _State.TEXT:
            out.append(self._release_inline())
        elif self._state is _State.HEADING:
            out.append(Colors.RESET)
        elif self._state is _State.TABLE_ROW:
            self._table_rows.append(self._line_head)
            self._line_head = ""
            out.append(self._flush_table())
        elif self._state is _State.CODE:
            if self._line_head:
                self._code_lines.append(self._line_head)
                self._line_head = ""
            out.append(self._flush_code())
        self._state = _State.LINE_START
        return "".join(out)

    # ------------------------------------------------------------------ 状态推进

    def _feed_char(self, ch: str, out: list[str]) -> None:
        """推进状态机一个字符，产出的文本片段追加到 out。"""
        if self._state is _State.LINE_START:
            if ch == "\n":
                self._line_head += ch
                self._finalize_line_start(out)
            else:
                self._line_head += ch
                self._classify_partial_head(out)
        elif self._state is _State.TEXT:
            if ch == "\n":
                # 行边界：未闭合构造不跨行（按原文放出），扫描器复位
                out.append(self._release_inline())
                out.append("\n")
                self._state = _State.LINE_START
                self._line_head = ""
            else:
                self._pending += ch
                out.append(self._drain_inline())
        elif self._state is _State.HEADING:
            if ch == "\n":
                out.append(Colors.RESET + "\n")
                self._state = _State.LINE_START
                self._line_head = ""
            else:
                # 标题正文流式直出（样式已在分类时开启）
                out.append(ch)
        elif self._state is _State.TABLE_ROW:
            if ch == "\n":
                self._table_rows.append(self._line_head)
                self._line_head = ""
                self._state = _State.LINE_START
            else:
                self._line_head += ch
        elif self._state is _State.CODE:
            self._feed_code_char(ch, out)

    def _finalize_line_start(self, out: list[str]) -> None:
        """行首缓冲收到换行：完成整行分类（空行/分隔线/普通短行）。

        表格行的换行不会到这里（TABLE_ROW 状态自行消费），此处的 "|"
        只可能是单字符后紧跟换行的病态行，按普通文本处理。
        """
        head = self._line_head
        self._line_head = ""
        body = head[:-1]  # 去掉换行
        if body and body[0] in "-*_" and len(set(body)) == 1 and len(body) >= 3:
            # 纯标记符整行 → 分隔线：渲染为 dim 横线
            out.append(Formatter.dim("─" * _RULE_WIDTH))
        elif not body:
            # 空行：若表格块挂起，先冲刷表格（块结束判定）
            if self._table_rows:
                out.append(self._flush_table())
        else:
            # 未成形的行首前缀（#/`/- 等）按普通文本放行
            self._pending = body
            out.append(self._drain_inline())
            out.append(self._release_inline())
        out.append("\n")

    def _classify_partial_head(self, out: list[str]) -> None:
        """行首缓冲未收换行：尝试尽早分类，能定则转出 LINE_START。"""
        head = self._line_head
        first = head[0]

        # 表格块挂起时遇到非 | 开头的行 → 表格块结束，先冲刷
        if self._table_rows and first != "|":
            out.append(self._flush_table())

        if first == "#":
            stripped = head.lstrip("#")
            run = len(head) - len(stripped)
            if run > 6:
                # 第 7 个 # ：不构成标题，按普通文本
                self._start_text(out)
            elif len(head) > run:
                if head[run] == " ":
                    # "#{1,6} " → 标题：开启样式，丢弃前缀（含一个空格）
                    out.append(Colors.BOLD + Colors.CYAN)
                    self._state = _State.HEADING
                    self._line_head = ""
                else:
                    # "#foo"（无空格）非标题，按普通文本
                    self._start_text(out)
            # 全是 # ：继续等待下一个字符定夺
            return

        if first == "|":
            # 表格行：整行缓冲（重排对齐是块级行为）
            self._state = _State.TABLE_ROW
            return

        if first == "`":
            if head.startswith("```"):
                # 代码围栏开启：进入 CODE，语言标记丢弃至行尾
                self._state = _State.CODE
                self._code_state = _CodeState.INFO
                self._line_head = ""
                return
            if len(head) >= 3 or head[-1] != "`":
                # `x / ``x：反引号开头但不成围栏 → 行内代码场景，按普通文本
                self._start_text(out)
                return
            # 1-2 个纯反引号：继续等待
            return

        if first in "-*_":
            if len(set(head)) > 1:
                # 出现异种字符 → 列表项/粗体开头等，交给行内扫描
                self._start_text(out)
            elif len(head) > _MAX_MARKER_RUN:
                # 病态长标记行：按文本放行，避免无限扣押
                self._start_text(out)
            # 纯标记串：等行尾终判（分隔线）
            return

        # 其余（含 > 引用、列表项）：普通文本，原文直出
        self._start_text(out)

    def _start_text(self, out: list[str]) -> None:
        """转入普通文本状态：行首前缀并入行内扫描暂存区并尽力放出。"""
        self._state = _State.TEXT
        self._pending += self._line_head
        self._line_head = ""
        out.append(self._drain_inline())

    def _feed_code_char(self, ch: str, out: list[str]) -> None:
        """推进代码围栏块一个字符。"""
        if self._code_state is _CodeState.INFO:
            # 开围栏行的语言标记：丢弃
            if ch == "\n":
                self._code_state = _CodeState.LINE_HEAD
            return
        if self._code_state is _CodeState.LINE_HEAD:
            if ch == "\n":
                # 空代码行（含此前暂存的未成形 ` 前缀，一并作为内容）
                self._code_lines.append(self._line_head)
                self._line_head = ""
                return
            self._line_head += ch
            head = self._line_head
            if head[0] != "`":
                # 不以反引号开头：普通代码行
                self._code_state = _CodeState.IN_LINE
                return
            if head.startswith("```"):
                # 关闭围栏：本行剩余字符丢弃，整块冲刷
                self._code_state = _CodeState.DROPPING_FENCE_END
                self._line_head = ""
                return
            if len(head) >= 3:
                # ``x 之类：3 个字符仍未成围栏 → 普通代码行
                self._code_state = _CodeState.IN_LINE
            # 1-2 个反引号：继续等待是否成围栏
            return
        if self._code_state is _CodeState.IN_LINE:
            if ch == "\n":
                self._code_lines.append(self._line_head)
                self._line_head = ""
                self._code_state = _CodeState.LINE_HEAD
            else:
                self._line_head += ch
            return
        # DROPPING_FENCE_END：关闭围栏行内其余字符丢弃
        if ch == "\n":
            out.append(self._flush_code())
            self._state = _State.LINE_START
            self._line_head = ""

    # ------------------------------------------------------------------ 行内扫描

    def _drain_inline(self) -> str:
        """消费行内暂存区：放出所有可安全输出的带样式文本。

        规则：
        - 遇开标记（**/__/`/[）后未闭合且在暂存上限内 → 停在标记处等待后续 chunk
        - 超过上限仍未闭合 → 标记按字面放行，继续扫描其后内容
        - 行尾单字符（*/_）可能是下一 chunk 才补全的半截开标记 → 保留暂存
        """
        s = self._pending
        # 行尾半截开标记判定：单个 * 或 _（**/__ 已由开标记逻辑接管）
        safe_end = len(s)
        if s and (s.endswith("*") or s.endswith("_")) and (len(s) < 2 or s[-2] != s[-1]):
            safe_end -= 1
        out: list[str] = []
        pos = 0
        stopped = False
        while pos < safe_end and not stopped:
            ch = s[pos]
            if ch == "*" and s.startswith("**", pos):
                pos, stopped = self._try_markup(s, pos, "**", self._max_markup_hold, Colors.BOLD, out)
            elif ch == "_" and s.startswith("__", pos):
                pos, stopped = self._try_markup(s, pos, "__", self._max_markup_hold, Colors.BOLD, out)
            elif ch == "`":
                pos, stopped = self._try_markup(s, pos, "`", self._max_markup_hold, Colors.CYAN, out)
            elif ch == "[":
                pos, stopped = self._try_link(s, pos, out)
            else:
                out.append(ch)
                pos += 1
        self._pending = s[pos:]
        return "".join(out)

    def _release_inline(self) -> str:
        """按原文放出全部行内暂存（行边界/流结束的兜底）。"""
        raw = self._pending
        self._pending = ""
        return raw

    def _try_markup(
        self,
        s: str,
        pos: int,
        marker: str,
        cap: int,
        color: str,
        out: list[str],
    ) -> tuple[int, bool]:
        """处理一个行内标记（粗体/代码）：闭合则带样式输出。

        Returns:
            (新扫描位置, 是否停下等待后续 chunk)
        """
        end = s.find(marker, pos + len(marker))
        if end != -1:
            out.append(Formatter.colorize(s[pos + len(marker) : end], color))
            return end + len(marker), False
        if len(s) - pos <= cap:
            # 未闭合但在暂存上限内：停在标记处等下一个 chunk
            return pos, True
        # 超上限仍未闭合：标记按字面放行，继续扫描其后内容
        out.append(marker)
        return pos + len(marker), False

    def _try_link(self, s: str, pos: int, out: list[str]) -> tuple[int, bool]:
        """处理 [text](url)：文字着色 + URL 以 dim 括注展示。

        Returns:
            (新扫描位置, 是否停下等待后续 chunk)
        """
        close = s.find("](", pos + 1)
        if close != -1:
            url_end = s.find(")", close + 2)
            if url_end != -1:
                out.append(Formatter.colorize(s[pos + 1 : close], Colors.CYAN))
                out.append(Formatter.dim(f" ({s[close + 2 : url_end]})"))
                return url_end + 1, False
        if len(s) - pos <= self._max_link_hold:
            # 缺 ]、缺 (url)、缺 ) 之一：在链接暂存上限内等待
            return pos, True
        # 超上限仍未闭合：[ 按字面放行
        out.append("[")
        return pos + 1, False

    # ------------------------------------------------------------------ 块渲染

    def _flush_table(self) -> str:
        """冲刷表格块：丢分隔行、按显示宽度对齐重排、超宽列截断。"""
        rows = [self._split_table_row(line) for line in self._table_rows]
        self._table_rows = []
        body = [cells for cells in rows if not self._is_separator_row(cells)]
        if not body:
            return ""
        col_count = max(len(cells) for cells in body)
        for cells in body:
            cells.extend([""] * (col_count - len(cells)))
        # 各列宽度 = 最大显示宽度（cell_len 计全角），封顶截断
        widths = [min(max(cell_len(cells[i]) for cells in body), self._table_col_max) for i in range(col_count)]
        lines: list[str] = []
        for idx, cells in enumerate(body):
            padded = [self._fit_cell(cells[i], widths[i]) for i in range(col_count)]
            row_line = "| " + " | ".join(padded) + " |"
            # 首行视为表头：加粗
            lines.append(Formatter.colorize(row_line, Colors.BOLD) if idx == 0 else row_line)
            if idx == 0 and len(body) > 1:
                # 表头下补 dim 分隔线（对齐重排后的列宽）
                rule = "|" + "|".join("-" * (w + 2) for w in widths) + "|"
                lines.append(Formatter.dim(rule))
        return "\n".join(lines) + "\n"

    def _flush_code(self) -> str:
        """冲刷代码围栏块：整块 dim + 两空格缩进，内部不做任何行内解释。"""
        lines = self._code_lines
        self._code_lines = []
        if not lines:
            return ""
        rendered = [Formatter.dim("  " + line) if line else "" for line in lines]
        return "\n".join(rendered) + "\n"

    @staticmethod
    def _split_table_row(line: str) -> list[str]:
        """拆表格行：去首尾竖线后按 | 切分并去空白（不支持转义 \\|）。"""
        s = line.strip()
        if s.startswith("|"):
            s = s[1:]
        if s.endswith("|"):
            s = s[:-1]
        return [cell.strip() for cell in s.split("|")]

    @staticmethod
    def _is_separator_row(cells: list[str]) -> bool:
        """判定是否 |---|---| 形态的分隔行（允许 :--- / ---: 对齐标记）。"""
        non_empty = [cell for cell in cells if cell]
        return bool(non_empty) and all(_SEPARATOR_CELL_RE.match(cell) for cell in non_empty)

    def _fit_cell(self, cell: str, width: int) -> str:
        """单元格按显示宽度适配：超宽截断补省略号，不足右侧补空格对齐。"""
        if cell_len(cell) > width:
            kept: list[str] = []
            used = 0
            for ch in cell:
                w = cell_len(ch)
                if used + w > width - 1:  # 预留省略号宽度
                    break
                kept.append(ch)
                used += w
            cell = "".join(kept) + "…"
        return cell + " " * (width - cell_len(cell))
