# backend/app/cli/tui/screens/validation.py
"""
@fileoverview TUI 校验屏（P1 / V2-4 三栏重构）

功能概述:
- 实现「打开项目 → 执行校验 → 展示结果」闭环的校验屏。
- V2-4 起，从两栏（历史+结果）升级为专业三栏 IDE 感布局：
  * 左栏 #source-panel ：数据源树（表名/行数/错误数），校验后填充。
  * 中栏 #result-panel ：校验按钮 + 进度区 + 摘要日志 + 错误表格。
  * 右栏 #detail-panel ：选中错误行后展示完整字段详情。
- 联动：左栏选中某表 → 中栏 DataTable 按表过滤；中栏选中某行 → 右栏展示详情。
- 项目打开入口收敛到 Dashboard（最近项目）/ Ctrl+O，validation 屏不再内嵌 HistoryList。

架构设计:
- 屏注册到 SCREEN_REGISTRY（@register_screen("validation")），供 P6 装配。
- 错误/摘要的渲染数据结构对齐 CLI formatter.format_validation_result / format_validation_summary，
  但不 import formatter——本屏自行组织渲染，避免 CLI UI 层依赖泄漏到 TUI。
- 校验逻辑（worker / progress_callback / 摘要渲染）与 V2-3 一致，本屏仅改布局与联动。
- 全局项目状态通过 app 自身属性持有（project_path/project_config），若无则屏内临时持有。
"""

from __future__ import annotations

from typing import Any

from textual import work
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.widgets import (
    Button,
    DataTable,
    Label,
    ProgressBar,
    RichLog,
    Sparkline,
    Tree,
)

from app.cli.shared_services import project_ops
from app.cli.tui.protocols import register_screen
from app.cli.tui.screens.base import BaseScreen
from app.cli.tui.services.validation_service import ValidationResult, ValidationService
from app.shared.services.validation.progress import ProgressEvent

# DataTable 列定义：表/字段/行号/约束/消息
_ERROR_COLUMNS = ("表", "字段", "行号", "约束", "消息")

# Nerd Font / Unicode 字形（避免 emoji，保证终端宽度一致）
_ICON_FOLDER = "\uf07b"  #  数据源（表）节点
_ICON_DOC = "\uf15c"  #  单条错误（详情面板头部用，预留）
_ICON_ROOT = "\uf07c"  #  展开的根目录

# 校验前 Tree 占位文案 / 详情面板空态文案
_SOURCE_EMPTY_HINT = "[dim]校验后显示数据源[/dim]\n[dim]Ctrl+O 打开项目后按 Ctrl+R 校验[/dim]"
_DETAIL_EMPTY_HINT = "[dim]（暂无选中错误 · 从中间表格选择一行查看详情）[/dim]"


@register_screen("validation")
class ValidationScreen(BaseScreen):
    """校验屏：执行校验并展示数据源树 / 错误表 / 详情预览（三栏 IDE 感）。

    布局：顶部状态条 + 主区（数据源树 | 结果面板 | 详情面板）。
    校验结果由 ``ValidationService`` 返回；左栏树按表展示行数/错误数，
    中栏 DataTable 列出错误，右栏按选中错误展示完整字段。
    """

    screen_name = "validation"

    BINDINGS = [
        Binding("ctrl+r", "validate", "执行校验", show=True),
    ]

    def __init__(self) -> None:
        super().__init__()
        self._service = ValidationService()
        # 屏内持有的临时项目状态（仅当 App 未提供 ProjectState 时使用）
        self._local_project_path: str | None = None
        self._local_project_config: dict[str, Any] | None = None
        # Sparkline 数据点缓冲：每收到一个 ProgressEvent 追加一个错误数点
        # （Sparkline.data 是 reactive，原地 append 不触发刷新，故需整体重新赋值）
        self._spark_points: list[float] = []
        # 当前校验的全部错误（含表/字段/行号/约束/消息/数据源等完整字段）。
        # 供左栏按表统计、按 _table_filter 过滤后渲染 DataTable、按行号取详情。
        self._all_errors: list[dict[str, Any]] = []
        # 当前 DataTable 渲染的错误列表（过滤后），与表格行一一对应。
        # 详情面板按 cursor_row 直接索引本列表，避免错位。
        self._current_errors: list[dict[str, Any]] = []
        # DataTable 表名过滤：None 表示全部；选中左栏某表后置为其表名。
        self._table_filter: str | None = None
        # 结果面板加载态高亮（校验期间切换到 active 边框，结束时恢复）
        self._result_pulsing: bool = False

    # ---- 项目状态访问（优先用 App 的，回退到屏内临时态）----

    @property
    def project_path(self) -> str | None:
        """当前打开的项目路径，优先取 App 持有的状态，回退屏内临时态。"""
        app_path = getattr(self.app, "project_path", None)
        return app_path if app_path is not None else self._local_project_path

    @property
    def project_config(self) -> dict[str, Any] | None:
        """当前打开项目的清单配置，优先取 App 持有的状态，回退屏内临时态。"""
        app_cfg = getattr(self.app, "project_config", None)
        return app_cfg if app_cfg is not None else self._local_project_config

    @property
    def is_project_open(self) -> bool:
        """是否已打开项目。"""
        return self.project_path is not None

    def compose_content(self) -> ComposeResult:
        """组装屏布局：顶部状态条 + 主区（数据源树 | 结果面板 | 详情面板）。"""
        # 当作为独立屏挂载时 App 已有 Header/Footer；这里不加 Header 避免重复
        yield Label("未打开项目", id="status-label")
        with Horizontal(id="main-row"):
            # 左栏：数据源树（校验前为空，校验后按表展示行数/错误数）
            with Vertical(id="source-panel", classes="panel"):
                yield Label("数据源", classes="panel-header")
                # auto_expand=False 在 on_mount 设置（reactive 不是构造参数），
                # 使回车只触发 NodeSelected 用于过滤，不展开/折叠节点
                yield Tree(_SOURCE_EMPTY_HINT, id="source-tree")
            # 中栏：结果（按钮 + 进度区 + 摘要 + 错误表）
            with Vertical(id="result-panel", classes="panel"):
                yield Label("校验结果", classes="panel-header")
                yield Button("校验 (ctrl+r)", id="validate-btn", variant="primary")
                # 进度区：校验时显示 ProgressBar + Sparkline + 状态文本，空闲时隐藏
                with Horizontal(id="progress-row", classes="hidden"):
                    yield ProgressBar(id="validate-progress", total=100)
                    yield Sparkline(id="error-sparkline")
                yield Label("就绪", id="progress-status")
                yield RichLog(id="summary-log", markup=True)
                yield DataTable(id="error-table", cursor_type="row", zebra_stripes=True)
            # 右栏：详情预览（选中错误行后展示完整字段）
            with Vertical(id="detail-panel", classes="panel"):
                yield Label("详情", classes="panel-header")
                yield RichLog(id="detail-log", markup=True)

    def on_mount(self) -> None:
        """挂载时初始化错误表格列、详情空态、刷新状态文案，并播放入场淡入。

        入场动效由 ``super().on_mount()`` 经 ``BaseScreen`` 统一触发
        （多态调用本类重写的 ``_run_entrance_animation``），避免重复播放。
        """
        super().on_mount()
        table = self.query_one("#error-table", DataTable)
        table.add_columns(*_ERROR_COLUMNS)
        # auto_expand=False：回车只触发 NodeSelected 用于按表过滤，不展开/折叠
        # （Tree 的 auto_expand 是 reactive，构造时不接受关键字，故在挂载后设置）
        self.query_one("#source-tree", Tree).auto_expand = False
        self._render_detail_empty()
        self._refresh_status()

    def _run_entrance_animation(self) -> None:
        """三栏面板错开淡入。

        使用 Textual 原生 ``widget.styles.animate("opacity", ...)``：共享 Animator
        自动管理生命周期，无需手动持有 tween 引用。delay 最小 0.01，避免
        ``set_timer(0, ...)`` 触发 ZeroDivisionError。
        """
        panels = [
            self.query_one("#source-panel"),
            self.query_one("#result-panel"),
            self.query_one("#detail-panel"),
        ]
        for idx, panel in enumerate(panels):
            panel.styles.opacity = 0.0
            delay = max(0.01, idx * 0.06)
            self.set_timer(
                delay,
                lambda w=panel: w.styles.animate("opacity", 1.0, duration=0.2, easing="out_cubic"),
            )

    # ---- 事件处理 ----

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """校验按钮按下时执行校验。"""
        if event.button.id != "validate-btn":
            return
        # action_validate 经 @work 装饰为 worker，调用即触发，不需要 await
        self.action_validate()

    def on_tree_node_selected(self, event: Tree.NodeSelected[dict[str, Any]]) -> None:
        """左栏数据源树节点被选中：按表过滤 DataTable。

        - 叶子节点（data 含 table）：DataTable 只显示该表的错误。
        - 根节点（无 table 或 data 为空）：清除过滤，显示全部。

        auto_expand=False 时回车只触发 NodeSelected，不会展开/折叠，符合过滤语义。

        Args:
            event: Tree 的 NodeSelected 消息。
        """
        if event.control.id != "source-tree":
            return
        node = event.node
        data = node.data or {}
        table_name = data.get("table")
        # 叶子节点的 data 含 table 时设过滤；根/未知节点清除过滤
        self._set_table_filter(table_name)

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        """中栏错误表行被高亮（光标移动）时，在右栏展示该错误完整字段。

        使用 RowHighlighted（光标移动即触发）而非 RowSelected（需回车），
        是为了在 IDE 感下「上下浏览 → 实时预览详情」更顺滑。

        Args:
            event: DataTable 的 RowHighlighted 消息，含 cursor_row。
        """
        if event.data_table.id != "error-table":
            return
        self._render_detail_at(event.cursor_row)

    @work(thread=True, exclusive=True, name="validation")
    def action_validate(self) -> None:
        """执行校验（worker 线程，不阻塞 UI）。

        读取项目状态，调用 ValidationService，校验过程中通过 progress_callback
        收 ProgressEvent 并经 ``call_from_thread`` 回 UI 线程更新进度区；完成后
        渲染结果。未打开项目或找不到清单时在摘要区提示；异常以通知展示，不崩溃。

        Note:
            - ``@work(thread=True)`` 使本方法在独立线程执行，UI 线程不阻塞。
            - ``exclusive=True`` 防止重复触发（校验中再按 Ctrl+R 不会重启）。
            - 所有 widget 操作必须经 ``self.app.call_from_thread`` 回 UI 线程。
        """
        # 前置检查：未打开项目或找不到清单（同步做，结果经 call_from_thread 写 UI）
        if not self.is_project_open:
            self.app.call_from_thread(self._write_summary, "[yellow]请先按 Ctrl+O 打开一个项目[/yellow]")
            return
        manifest_path = project_ops.find_manifest(self.project_path)  # type: ignore[arg-type]
        if manifest_path is None:
            self.app.call_from_thread(self._write_summary, "[red]未找到 project.precis.yaml，无法校验[/red]")
            return
        data_dir = self.project_path  # type: ignore[assignment]
        validation_settings = (self.project_config or {}).get("validation", {})
        script_security = (self.project_config or {}).get("script_security", {})

        self.app.call_from_thread(self._write_summary, "[cyan]正在校验数据...[/cyan]")
        self.app.call_from_thread(self._start_result_pulse)

        def on_progress(event: ProgressEvent) -> None:
            # worker 线程内：经 call_from_thread 回 UI 线程更新进度区
            self.app.call_from_thread(self._update_progress, event)

        try:
            result = self._service.validate(
                manifest_path=manifest_path,
                data_dir=data_dir,
                validation_settings=validation_settings,
                script_security=script_security,
                progress_callback=on_progress,
            )
        except Exception as exc:  # noqa: BLE001 - UI 层兜底，不向 stderr 泄漏
            self.app.call_from_thread(self._write_summary, f"[red]校验异常：{exc}[/red]")
            self.app.call_from_thread(self._finish_progress, False, True)
            return
        self.app.call_from_thread(self._render_result, result)
        self.app.call_from_thread(self._finish_progress, result.has_errors, False)

    def _start_result_pulse(self) -> None:
        """校验期间给结果面板加边框高亮（静态 active 边框）。

        原 pulse_border_color 用 10fps 定时器循环改边框色；现改用静态
        active 边框——零 timer、零泄漏，视觉等效（持续高亮表示加载中）。
        """
        panel = self.query_one("#result-panel")
        try:
            panel.styles.border = ("solid", "$tui-border-active")
            self._result_pulsing = True
        except Exception:  # noqa: BLE001 - widget 可能已失效
            pass

    def _stop_result_pulse(self) -> None:
        """恢复结果面板边框。"""
        try:
            self.query_one("#result-panel").styles.border = ("solid", "$tui-border")
        except Exception:  # noqa: BLE001
            pass
        self._result_pulsing = False

    # ---- 进度区更新（UI 线程，由 worker 的 call_from_thread 调用）----

    def _update_progress(self, event: ProgressEvent) -> None:
        """根据 ProgressEvent 更新进度区（在 UI 线程执行）。

        显示进度区、更新状态文本、推进 ProgressBar、向 Sparkline 追加数据点。
        由 worker 通过 ``self.app.call_from_thread(self._update_progress, event)`` 调用。

        Args:
            event: 校验执行器上抛的进度事件。
        """
        # 显示进度区
        self.query_one("#progress-row").remove_class("hidden")
        # 状态文本
        status = self.query_one("#progress-status", Label)
        if event.stage == "done":
            status.update(
                f"[green]完成[/green] · {event.rows_done} 行 · {event.errors_so_far} 错误 · {event.elapsed_ms}ms"
            )
        elif event.table:
            chunk_hint = f" (分块 {event.chunk_index}/{event.chunk_total})" if event.chunk_total else ""
            total_hint = event.rows_total if event.rows_total > 0 else "?"
            status.update(
                f"正在校验 {event.table}{chunk_hint} · {event.rows_done}/{total_hint} 行 · {event.errors_so_far} 错误"
            )
        else:
            status.update(f"{event.stage} · 已处理 {event.rows_done} 行 · {event.errors_so_far} 错误")
        # ProgressBar：按 rows_done/rows_total 推进百分比
        if event.rows_total > 0:
            pb = self.query_one("#validate-progress", ProgressBar)
            pb.update(progress=int(event.rows_done / event.rows_total * 100))
        # Sparkline：追加累计错误数点（reactive，需整体重新赋值触发刷新）
        self._spark_points.append(float(event.errors_so_far))
        self.query_one("#error-sparkline", Sparkline).data = list(self._spark_points)

    def _finish_progress(self, errors: bool = False, failed: bool = False) -> None:
        """校验结束的进度区收尾（在 UI 线程执行）。

        ProgressBar 推满或标记失败；校验通过且未失败时触发庆祝特效。
        进度区保留显示（展示完整 Sparkline 曲线与最终状态），不重新隐藏。

        Args:
            errors: 校验结果是否含错误。
            failed: 是否因异常失败（失败时 ProgressBar 置 0 并标注失败）。
        """
        pb = self.query_one("#validate-progress", ProgressBar)
        status = self.query_one("#progress-status", Label)
        self._stop_result_pulse()
        if failed:
            pb.update(progress=0)
            status.update("[red]校验失败[/red]")
        else:
            pb.update(progress=100)
            # 通过（无错误）时触发庆祝
            if not errors:
                self._trigger_celebration()

    # ---- 渲染 ----

    def _render_result(self, result: ValidationResult) -> None:
        """渲染校验结果：摘要写入 RichLog，错误填入 DataTable，数据源填入 Tree。

        Args:
            result: ValidationService 返回的 ValidationResult。
        """
        self._render_summary(result)
        # 缓存全部错误，供后续按表过滤与详情反查
        self._all_errors = list(result.errors)
        # 重置过滤（新一轮校验结果默认显示全部）
        self._table_filter = None
        self._render_source_tree(result)
        self._render_errors()
        self._flash_result_panels()

    def _flash_result_panels(self) -> None:
        """结果呈现时给左/中/右三栏加轻微高光闪烁。

        原用 ``animate_tint``（自建 tween），但 Textual 原生
        ``widget.styles.animate("tint", ...)`` 不支持设计变量且 tint 属性不可动画，
        故改用原生 ``opacity`` 闪烁：先把面板降到半透明，再用 ease_out 渐回
        完全不透明，制造「新结果到达」的短暂高光反馈。原生 animate 由共享
        Animator 自动管理生命周期，无需手动持有 tween 引用。
        """
        panels = [
            self.query_one("#source-panel"),
            self.query_one("#result-panel"),
            self.query_one("#detail-panel"),
        ]
        for idx, panel in enumerate(panels):
            # delay 最小 0.01：避免 set_timer(0, ...) 触发 ZeroDivisionError
            delay = max(0.01, idx * 0.05)
            self.set_timer(
                delay,
                lambda w=panel: _flash_one(w),
            )

        def _flash_one(w: Any) -> None:
            w.styles.opacity = 0.7
            w.styles.animate("opacity", 1.0, duration=0.18, easing="out_cubic")

    def _render_summary(self, result: ValidationResult) -> None:
        """渲染校验摘要到 RichLog。

        数据结构对齐 CLI formatter.format_validation_summary：
        - 数据表：从 validation_details.format_checks 取表名，从 raw_datasets 取行数。
        - 约束检查：从 validation_details.constraint_checks 取通过/失败统计与逐项。

        Args:
            result: 校验结果。
        """
        log = self.query_one("#summary-log", RichLog)
        log.clear()

        # 加载警告（loading_errors）：优先展示 title/description/fix_hint
        if result.loading_errors:
            log.write("[yellow]加载警告：[/yellow]")
            for err in result.loading_errors:
                error_type = err.get("error_type", "Unknown")
                title = err.get("title") or err.get("message") or ""
                log.write(f"  - [{error_type}] {title}")
                if err.get("description"):
                    log.write(f"     说明: {err['description']}")
                if err.get("fix_hint"):
                    log.write(f"     建议: {err['fix_hint']}")
            log.write("")

        log.write(f"[bold]校验耗时：[/bold] {result.duration_ms} ms")

        details = result.validation_details
        raw_datasets = result.raw_datasets or {}

        if not details:
            log.write("[yellow]• 未返回校验明细，无法确认实际执行的检查项数[/yellow]")
        else:
            # 数据表/行数统计
            format_checks = details.get("format_checks", []) or []
            log.write(f"[bold]数据表：[/bold] {len(format_checks)} 个")
            for fc in format_checks:
                table = fc.get("table", "?")
                ds = raw_datasets.get(table)
                row_count = len(ds) if ds is not None and hasattr(ds, "__len__") else "-"
                source = fc.get("source_file") or ""
                src_hint = f" [dim]({source})[/dim]" if source else ""
                log.write(f"    • {table}: {row_count} 行{src_hint}")

            # 约束检查统计
            constraint_checks = details.get("constraint_checks", []) or []
            total = len(constraint_checks)
            failed = [c for c in constraint_checks if not c.get("passed", True)]
            passed = total - len(failed)
            if not failed:
                log.write(f"[bold]约束检查：[/bold] {total} 项，全部通过 ✓")
            else:
                log.write(f"[bold]约束检查：[/bold] {total} 项，{passed} 通过 / {len(failed)} 失败 ✗")
            for c in constraint_checks:
                passed_flag = c.get("passed", True)
                ctype = c.get("constraint_type", "Constraint")
                ctype_display = ctype.replace("Constraint", "").replace("s", "", 1) if ctype else "Constraint"
                desc = c.get("description") or f"{ctype_display}: {c.get('table', '?')}"
                tag = "[green]✓[/green]" if passed_flag else "[red]✗[/red]"
                err_cnt = c.get("error_count", 0)
                err_hint = f" [red]({err_cnt} 错误)[/red]" if err_cnt else ""
                log.write(f"    • {desc}  {tag}{err_hint}")

        # 错误总数
        if result.has_errors:
            counts: dict[str, int] = {}
            for err in result.errors:
                et = err.get("error_type", "UnknownError")
                counts[et] = counts.get(et, 0) + 1
            log.write("")
            log.write(f"[bold]总计：[/bold] {len(result.errors)} 个错误")
            log.write("[bold]按类型统计：[/bold]")
            for et, cnt in sorted(counts.items()):
                log.write(f"   • {et}: {cnt}")
        else:
            log.write("[green]✓ 校验通过，未发现任何错误！[/green]")
            self._trigger_celebration()

    def _render_errors(self) -> None:
        """渲染错误到 DataTable（列：表/字段/行号/约束/消息）。

        根据 ``self._table_filter`` 过滤：None 显示全部；非空只显示该表。
        渲染后同步刷新 ``self._current_errors``，使详情面板能按 cursor_row 反查。
        """
        table = self.query_one("#error-table", DataTable)
        table.clear()
        # 按表过滤
        if self._table_filter is None:
            rendered = self._all_errors
        else:
            rendered = [err for err in self._all_errors if str(err.get("table", "") or "") == self._table_filter]
        # 同步当前渲染列表（详情面板按 cursor_row 索引）
        self._current_errors = rendered
        for err in rendered:
            table_name = str(err.get("table", "") or "")
            column = str(err.get("column", "") or "")
            row_index = err.get("row_index")
            row_index_str = "" if row_index is None else str(row_index)
            constraint = str(err.get("error_type", "") or "")
            message = str(err.get("message", "") or "")
            table.add_row(table_name, column, row_index_str, constraint, message)
        # 重置详情面板：行数变化后旧 cursor_row 不再有效
        self._render_detail_empty()

    def _render_source_tree(self, result: ValidationResult) -> None:
        """渲染左栏数据源树：按表展示行数与错误数。

        数据来源：
        - 表与行数：``validation_details.format_checks``（表名 + 行数；行数优先取 raw_datasets）。
        - 错误数：遍历 ``result.errors`` 按表统计。
        - 没有格式检查但仍有错误时，补全错误涉及的表（行数显示为 -）。

        树结构：
        ``{root: 全部 (N 错误)}``
        ``├──  users (1234 行, 5 错误)``
        ``└──  orders (890 行, 0 错误)``
        每个「表」叶子节点的 ``data`` 存 ``{"table": <表名>}`` 供选中时过滤。
        选中根节点（无 table）时清除过滤。

        Args:
            result: 校验结果。
        """
        tree = self.query_one("#source-tree", Tree)
        # 按表统计错误数
        err_counts: dict[str, int] = {}
        for err in result.errors:
            tname = str(err.get("table", "") or "")
            err_counts[tname] = err_counts.get(tname, 0) + 1

        # 表 -> 行数（优先 raw_datasets，回退 format_checks.error_count 占位）
        details = result.validation_details or {}
        format_checks = details.get("format_checks", []) or {}
        raw_datasets = result.raw_datasets or {}
        table_rows: dict[str, Any] = {}
        for fc in format_checks:
            tname = str(fc.get("table", "") or "")
            if not tname:
                continue
            ds = raw_datasets.get(tname)
            if ds is not None and hasattr(ds, "__len__"):
                table_rows[tname] = len(ds)
            else:
                table_rows[tname] = "-"

        # 合并：错误中出现但 format_checks 未列出的表也补进树
        all_tables = list(dict.fromkeys([*table_rows.keys(), *err_counts.keys()]))

        total_errs = len(result.errors)
        # 重建树（root.label 改为「全部 (N 错误)」）
        tree.reset(f"{_ICON_ROOT} 全部 ({total_errs} 错误)")
        # 按错误数降序、表名升序排序，错误最多的表排在最前（更聚焦问题）
        for tname in sorted(
            all_tables,
            key=lambda n: (-(err_counts.get(n, 0)), n),
        ):
            rows = table_rows.get(tname, "-")
            errs = err_counts.get(tname, 0)
            err_tag = f"[red]{errs} 错误[/red]" if errs else "[green]0 错误[/green]"
            label = f"{_ICON_FOLDER} {tname} ({rows} 行, {err_tag})"
            tree.root.add_leaf(
                label,
                data={"table": tname, "rows": rows, "errors": errs},
            )
        tree.root.expand()

    def _render_detail_at(self, cursor_row: int) -> None:
        """在右栏详情面板渲染指定错误行的完整字段。

        Args:
            cursor_row: DataTable 中当前高亮的行号（与 _current_errors 索引对齐）。
        """
        if cursor_row < 0 or cursor_row >= len(self._current_errors):
            self._render_detail_empty()
            return
        err = self._current_errors[cursor_row]
        log = self.query_one("#detail-log", RichLog)
        log.clear()

        table_name = str(err.get("table", "") or "") or "-"
        column = str(err.get("column", "") or "") or "-"
        row_index = err.get("row_index")
        row_index_str = "-" if row_index is None else str(row_index)
        error_type = str(err.get("error_type", "") or "") or "-"
        message = str(err.get("message", "") or "") or "-"
        source_file = str(err.get("source_file", "") or "") or "-"
        source_sheet = str(err.get("source_sheet", "") or "")
        chunk_index = err.get("chunk_index")
        fix_hint = err.get("fix_hint")

        log.write(f"[bold]{_ICON_DOC} 错误详情[/bold]")
        log.write("")
        log.write(f"[bold]表：[/bold]     {table_name}")
        log.write(f"[bold]字段：[/bold]   {column}")
        log.write(f"[bold]行号：[/bold]   {row_index_str}")
        log.write(f"[bold]约束类型：[/bold] {error_type}")
        log.write(f"[bold]消息：[/bold]   {message}")
        log.write("")
        src = source_file
        if source_sheet:
            src = f"{source_file} ({source_sheet})"
        log.write(f"[dim]数据源：[/dim] {src}")
        chunk_str = str(chunk_index) if chunk_index is not None else "-"
        log.write(f"[dim]分块：[/dim]   {chunk_str}")
        if fix_hint:
            log.write("")
            log.write(f"[yellow]修复建议：[/yellow] {fix_hint}")

    def _render_detail_empty(self) -> None:
        """右栏详情面板的空态（未选中错误行或无数据时）。"""
        log = self.query_one("#detail-log", RichLog)
        log.clear()
        log.write(_DETAIL_EMPTY_HINT)

    def _set_table_filter(self, table_name: str | None) -> None:
        """设置 DataTable 的表名过滤并重新渲染。

        选中左栏某表 → 只显示该表错误；选中根或传 None → 显示全部。
        过滤后同步刷新 ``_current_errors`` 并重置详情面板。

        Args:
            table_name: 表名；None 表示显示全部。
        """
        if table_name == self._table_filter:
            # 无变化时不重渲染（避免光标跳动 / 性能浪费）
            return
        self._table_filter = table_name
        self._render_errors()
        # 在摘要区给一行简短提示，让用户感知当前过滤状态
        if table_name is None:
            self._write_summary("[dim]已显示全部表的错误[/dim]")
        else:
            cnt = sum(1 for err in self._all_errors if str(err.get("table", "") or "") == table_name)
            self._write_summary(f"[cyan]已过滤到表 {table_name}（{cnt} 个错误）[/cyan]")

    def _write_summary(self, text: str) -> None:
        """向 RichLog 写入一行文本（用于状态/提示信息）。"""
        self.query_one("#summary-log", RichLog).write(text)

    def _trigger_celebration(self) -> None:
        """校验通过时触发庆祝特效。"""
        app = self.app
        if hasattr(app, "trigger_fx"):
            app.trigger_fx("confetti")

    def _refresh_status(self) -> None:
        """刷新顶部状态条文案，显示当前项目路径或未打开提示。"""
        label = self.query_one("#status-label", Label)
        if self.is_project_open:
            display = project_ops.resolve_project_label(self.project_path)  # type: ignore[arg-type]
            label.update(f"[green]●[/green] {display}  [dim]{self.project_path}[/dim]")
        else:
            label.update("[yellow]○ 未打开项目（Ctrl+O 打开）[/yellow]")


__all__ = ["ValidationScreen"]
