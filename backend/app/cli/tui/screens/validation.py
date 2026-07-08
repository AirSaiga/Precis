# backend/app/cli/tui/screens/validation.py
"""
@fileoverview TUI 校验屏（P1）

功能概述:
- 实现「打开项目 → 执行校验 → 展示结果」闭环的最小可用屏。
- 左侧 ``HistoryList`` 展示历史项目并触发打开；选中后更新项目路径/配置。
- 校验按钮调用 ``ValidationService.validate``，结果用 ``DataTable``（表/字段/行号/约束/消息）
  展示错误，用 ``RichLog`` 展示摘要（数据表/行数、约束检查通过/失败）。

架构设计:
- 屏注册到 SCREEN_REGISTRY（@register_screen("validation")），供 P6 装配。
- 错误/摘要的渲染数据结构对齐 CLI formatter.format_validation_result / format_validation_summary，
  但不 import formatter——本屏自行组织渲染，避免 CLI UI 层依赖泄漏到 TUI。
- 项目操作直接调 shared_services.project_ops（经 HistoryList）；校验经 ValidationService。
- 全局项目状态通过 app 自身属性持有（project_path/project_config），若无则屏内临时持有。
"""

from __future__ import annotations

from typing import Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import Button, DataTable, Label, RichLog

from app.cli.shared_services import project_ops
from app.cli.tui.protocols import register_screen
from app.cli.tui.services.validation_service import ValidationResult, ValidationService
from app.cli.tui.widgets.history_list import HistoryList

# DataTable 列定义：表/字段/行号/约束/消息
_ERROR_COLUMNS = ("表", "字段", "行号", "约束", "消息")


@register_screen("validation")
class ValidationScreen(Screen):
    """校验屏：打开项目、执行校验、展示错误与摘要。

    布局：左侧历史列表 + 右侧（摘要日志 + 错误表格）。
    校验结果由 ``ValidationService`` 返回，错误填入 DataTable，摘要写入 RichLog。
    """

    BINDINGS = [
        Binding("ctrl+r", "validate", "执行校验", show=True),
    ]

    DEFAULT_CSS = """
    ValidationScreen {
        layout: vertical;
        padding: 0 1;
    }
    #status-label {
        height: auto;
        min-height: 1;
        margin-bottom: 1;
        padding: 0 1;
        color: $text-muted;
        text-style: bold;
    }
    #main-row {
        height: 1fr;
    }
    #history-panel {
        width: 1fr;
        height: 100%;
        padding: 0 1 0 0;
    }
    #result-panel {
        width: 2fr;
        height: 100%;
    }
    #summary-log {
        height: 40%;
        border: round $accent;
        background: $surface;
        padding: 0 1;
        margin-bottom: 1;
    }
    #error-table {
        height: 60%;
        border: round $warning;
        background: $surface;
    }
    Button {
        margin: 0 1 1 0;
    }
    """

    def __init__(self) -> None:
        super().__init__()
        self._service = ValidationService()
        # 屏内持有的临时项目状态（仅当 App 未提供 ProjectState 时使用）
        self._local_project_path: str | None = None
        self._local_project_config: dict[str, Any] | None = None

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

    def compose(self) -> ComposeResult:
        """组装屏布局：顶部状态条 + 主区（历史 | 结果面板）。"""
        # 当作为独立屏挂载时 App 已有 Header/Footer；这里不加 Header 避免重复
        yield Label("未打开项目", id="status-label")
        with Horizontal(id="main-row"):
            with Vertical(id="history-panel"):
                yield Label("[bold]历史项目[/bold]（回车打开）")
                yield HistoryList(id="history-list")
            with Vertical(id="result-panel"):
                yield Button("校验 (ctrl+r)", id="validate-btn", variant="primary")
                yield RichLog(id="summary-log", markup=True)
                yield DataTable(id="error-table")

    def on_mount(self) -> None:
        """挂载时初始化错误表格列并刷新状态文案。"""
        table = self.query_one("#error-table", DataTable)
        table.add_columns(*_ERROR_COLUMNS)
        self._refresh_status()

    # ---- 事件处理 ----

    def on_history_list_history_opened(self, event: HistoryList.HistoryOpened) -> None:
        """历史列表打开项目后：更新项目状态、刷新状态条与历史列表。

        Args:
            event: HistoryList.HistoryOpened，含 OpenResult。
        """
        event.stop()
        result = event.result
        if not result.success:
            self._write_summary(f"[red]打开失败：{result.message}[/red]")
            return
        # 更新屏内临时态；若 App 持有同名属性也一并同步
        self._local_project_path = result.project_path
        self._local_project_config = result.config
        if hasattr(self.app, "project_path"):
            self.app.project_path = result.project_path  # type: ignore[attr-defined]
        if hasattr(self.app, "project_config"):
            self.app.project_config = result.config  # type: ignore[attr-defined]
        self._refresh_status()
        self._write_summary(f"[green]{result.message}[/green]")
        # 刷新历史列表以反映最新打开
        event.list_view.reload()

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        """校验按钮按下时执行校验。"""
        if event.button.id != "validate-btn":
            return
        await self.action_validate()

    async def action_validate(self) -> None:
        """执行校验：读取项目状态，调用 ValidationService，渲染结果。

        未打开项目时在摘要区提示；异常时以通知展示，不崩溃。
        """
        if not self.is_project_open:
            self._write_summary("[yellow]请先从左侧历史列表打开一个项目[/yellow]")
            return
        manifest_path = project_ops.find_manifest(self.project_path)  # type: ignore[arg-type]
        if manifest_path is None:
            self._write_summary("[red]未找到 project.precis.yaml，无法校验[/red]")
            return
        data_dir = self.project_path  # type: ignore[assignment]
        validation_settings = (self.project_config or {}).get("validation", {})
        script_security = (self.project_config or {}).get("script_security", {})

        self._write_summary("[cyan]正在校验数据...[/cyan]")
        try:
            result = self._service.validate(
                manifest_path=manifest_path,
                data_dir=data_dir,
                validation_settings=validation_settings,
                script_security=script_security,
            )
        except Exception as exc:  # noqa: BLE001 - UI 层兜底，不向 stderr 泄漏
            self._write_summary(f"[red]校验异常：{exc}[/red]")
            self.app.bell()
            return
        self._render_result(result)

    # ---- 渲染 ----

    def _render_result(self, result: ValidationResult) -> None:
        """渲染校验结果：摘要写入 RichLog，错误填入 DataTable。

        Args:
            result: ValidationService 返回的 ValidationResult。
        """
        self._render_summary(result)
        self._render_errors(result)

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

    def _render_errors(self, result: ValidationResult) -> None:
        """渲染错误到 DataTable（列：表/字段/行号/约束/消息）。

        Args:
            result: 校验结果。
        """
        table = self.query_one("#error-table", DataTable)
        table.clear()
        if not result.has_errors:
            return
        for err in result.errors:
            table_name = str(err.get("table", "") or "")
            column = str(err.get("column", "") or "")
            row_index = err.get("row_index")
            row_index_str = "" if row_index is None else str(row_index)
            constraint = str(err.get("error_type", "") or "")
            message = str(err.get("message", "") or "")
            table.add_row(table_name, column, row_index_str, constraint, message)

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
            label.update("[yellow]○ 未打开项目[/yellow]")


__all__ = ["ValidationScreen"]
