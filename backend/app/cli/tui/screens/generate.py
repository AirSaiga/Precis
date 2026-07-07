# backend/app/cli/tui/screens/generate.py
"""@fileoverview TUI AI 配置生成/迁移屏

功能概述:
- ``GenerateScreen``：从数据文件生成 Precis 配置（数据文件多选 + 参数表单 + TabbedContent
  预览 manifest/schemas/constraints + 应用按钮）
- ``MigrateScreen``：从旧脚本迁移生成配置（脚本路径 + 语言选择 + 数据文件 + 预览 + 应用）

架构设计:
- 两个屏都通过 ``GenerationService``（tui/services/generation_service）调用底层
  ConfigGenerationService / ConfigMigrationService，写盘委托 shared_services.generation_ops
- 屏通过 ``self.app`` 读取全局项目状态（ProjectState 协议：project_path / project_config /
  is_project_open）。P6 的 app.py 会实现该协议并装配屏。
- 进度回调写入底部状态条（``Static``），生成完成后在 ``TabbedContent`` 内展示 YAML 预览
- ``@register_screen`` 把两个屏注册到 SCREEN_REGISTRY，供 P6 装配

输入示例（用户操作）:
    1. 打开项目后进入 Generate 屏
    2. 在 SelectionList 勾选数据文件
    3. 调整采样行数 / 正则开关
    4. 点「生成预览」→ TabbedContent 展示各段配置
    5. 点「应用」→ 写盘到项目目录

输出示例:
    project.precis.yaml + schemas/*.schema.yaml + constraints/*.constraint.yaml
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING, Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, VerticalScroll
from textual.screen import Screen
from textual.widgets import (
    Button,
    Input,
    Label,
    RichLog,
    Select,
    SelectionList,
    Static,
    Switch,
    TabbedContent,
    TabPane,
)
from textual.widgets.selection_list import Selection

from app.cli.tui.protocols import register_screen
from app.cli.tui.services.generation_service import GenerationService

if TYPE_CHECKING:
    from app.cli.tui.protocols import ProjectState

logger = logging.getLogger(__name__)

# 数据文件扫描的默认空 patterns（触发 data/ 目录扫描）
_EMPTY_PATTERNS: list[str] = []

# 支持的迁移语言选项
_MIGRATE_LANGUAGES: list[tuple[str, str]] = [
    ("Python", "python"),
    ("SQL", "sql"),
    ("Excel 公式", "excel_formula"),
    ("自然语言", "natural_language"),
]


class _GenerationScreenBase(Screen):
    """生成/迁移屏共享基类。

    收敛两个屏共用的状态条、项目状态读取、进度回调、预览渲染逻辑。
    子类只需实现 ``compose_body``（参数区）与 ``run_generation``（触发生成）。
    """

    BINDINGS = [
        Binding("ctrl+g", "generate", "生成"),
        Binding("ctrl+a", "apply", "应用"),
        Binding("escape", "dismiss", "关闭"),
    ]

    DEFAULT_CSS = """
    Label.title { text-style: bold; margin-bottom: 1; }
    Static#status { background: $panel; padding: 0 1; color: $text-muted; }
    RichLog { border: round $primary; }
    Horizontal { height: auto; }
    """

    def __init__(self) -> None:
        super().__init__()
        self._service = GenerationService()
        self._last_result: dict[str, Any] | None = None

    # ---- 项目状态访问（ProjectState 协议由 app 实现）----

    @property
    def project_state(self) -> ProjectState:
        """获取全局项目状态（app 实现 ProjectState 协议）。"""
        return self.app  # type: ignore[return-value]

    @property
    def project_path(self) -> str | None:
        """当前项目根路径（未打开为 None）。

        app 可能尚未实现 ProjectState（P6 才装配），用 getattr 防御性读取。
        """
        return getattr(self.app, "project_path", None)

    @property
    def project_config(self) -> dict[str, Any] | None:
        """当前项目清单配置（防御性读取，见 project_path 说明）。"""
        return getattr(self.app, "project_config", None)

    @property
    def is_project_open(self) -> bool:
        """是否已打开项目。优先用 app 的 is_project_open，否则按 path 是否非空判断。"""
        is_open = getattr(self.app, "is_project_open", None)
        if isinstance(is_open, bool):
            return is_open
        return self.project_path is not None

    def _project_name(self) -> str:
        """解析项目显示名（兜底用目录名）。"""
        cfg = self.project_config or {}
        name = cfg.get("project", {}).get("name")
        if name:
            return str(name)
        if self.project_path:
            return Path(self.project_path).name
        return ""

    def _project_id(self) -> str:
        """解析项目 ID（兜底用 name）。"""
        cfg = self.project_config or {}
        pid = cfg.get("project", {}).get("id")
        if pid:
            return str(pid)
        return self._project_name()

    # ---- 状态条 ----

    def _set_status(self, message: str) -> None:
        """更新底部状态条文本。"""
        try:
            status = self.query_one("#status", Static)
            status.update(message)
        except Exception:
            # 状态条可能尚未挂载，忽略
            logger.debug("状态条未就绪，丢弃状态消息: %s", message)

    def _make_progress_callback(self) -> Any:
        """构造进度回调，把进度写入状态条。"""

        def _cb(stage: str, progress: float, extra: dict[str, Any] | None = None) -> None:
            msg = extra.get("message") if extra else None
            prefix = f"[{stage}]" if not msg else f"[{stage}] {msg}"
            self._set_status(f"{prefix} {progress:.0f}%")

        return _cb

    # ---- 预览渲染 ----

    def _render_preview(self, result: dict[str, Any]) -> None:
        """把生成结果渲染到 TabbedContent 的各 Tab。

        - yaml 预览（原始）
        - manifest（JSON 展示）
        - schemas / constraints / regex 概览
        """
        import json

        yaml_preview = result.get("yaml_preview", "")
        manifest = result.get("manifest") or {}
        schemas = result.get("schemas", {}) or {}
        constraints = result.get("constraints", {}) or {}
        regex_nodes = result.get("regex_nodes", {}) or {}

        # yaml 预览
        try:
            yaml_log = self.query_one("#preview-yaml", RichLog)
            yaml_log.clear()
            yaml_log.write(yaml_preview or "(无 YAML 预览)")
        except Exception:
            logger.debug("yaml 预览区未就绪")

        # manifest
        try:
            manifest_log = self.query_one("#preview-manifest", RichLog)
            manifest_log.clear()
            manifest_log.write(json.dumps(manifest, ensure_ascii=False, indent=2) or "{}")
        except Exception:
            logger.debug("manifest 预览区未就绪")

        # schemas
        try:
            schemas_log = self.query_one("#preview-schemas", RichLog)
            schemas_log.clear()
            if schemas:
                for sid, schema in schemas.items():
                    schemas_log.write(f"=== {sid} ===")
                    schemas_log.write(json.dumps(schema, ensure_ascii=False, indent=2))
            else:
                schemas_log.write("(无 schema)")
        except Exception:
            logger.debug("schemas 预览区未就绪")

        # constraints
        try:
            constraints_log = self.query_one("#preview-constraints", RichLog)
            constraints_log.clear()
            if constraints:
                for cid, constraint in constraints.items():
                    constraints_log.write(f"=== {cid} ===")
                    constraints_log.write(json.dumps(constraint, ensure_ascii=False, indent=2))
            else:
                constraints_log.write("(无 constraint)")
        except Exception:
            logger.debug("constraints 预览区未就绪")

        # regex
        try:
            regex_log = self.query_one("#preview-regex", RichLog)
            regex_log.clear()
            if regex_nodes:
                for rid, regex_node in regex_nodes.items():
                    regex_log.write(f"=== {rid} ===")
                    regex_log.write(json.dumps(regex_node, ensure_ascii=False, indent=2))
            else:
                regex_log.write("(无 regex 节点)")
        except Exception:
            logger.debug("regex 预览区未就绪")

    # ---- 应用写盘 ----

    def _apply_result(self) -> None:
        """把上一次生成结果写入项目目录。"""
        if not self._last_result:
            self._set_status("无可应用的结果，请先生成预览")
            return
        project_path = self.project_path
        if not project_path:
            self._set_status("未打开项目，无法应用")
            return
        try:
            written = self._service.apply_result(self._last_result, project_path)
            schemas = self._last_result.get("schemas", {}) or {}
            constraints = self._last_result.get("constraints", {}) or {}
            regex_nodes = self._last_result.get("regex_nodes", {}) or {}
            self._set_status(
                f"已写入 {len(written)} 个文件："
                f"{len(schemas)} schema / {len(constraints)} constraint / {len(regex_nodes)} regex"
            )
        except Exception as e:
            logger.error("写盘失败: %s", e, exc_info=True)
            self._set_status(f"写盘失败: {e}")

    def action_apply(self) -> None:
        """快捷键 Ctrl+A：应用结果。"""
        self._apply_result()

    def action_dismiss(self) -> None:
        """Esc：关闭屏。"""
        self.app.pop_screen()

    # ---- 数据文件扫描 ----

    def _refresh_data_files(self) -> list[str]:
        """扫描项目数据文件并刷新 SelectionList。"""
        project_path = self.project_path
        if not project_path:
            return []
        files = self._service.scan_data_files(_EMPTY_PATTERNS, project_path)
        try:
            sel_list = self.query_one("#data-files", SelectionList)
            sel_list.clear_options()
            for f in files:
                # 显示相对路径，值用绝对路径
                try:
                    label = os.path.relpath(f, project_path)
                except ValueError:
                    label = f
                sel_list.add_option(Selection(label, f))
        except Exception:
            logger.debug("数据文件列表未就绪")
        return files


@register_screen("generate")
class GenerateScreen(_GenerationScreenBase):
    """AI 配置生成屏。

    布局：数据文件多选 + 参数表单（采样行数 / 采样值 / 正则开关 / 迭代次数 / Agent 模式）
    + 生成/应用按钮 + TabbedContent 预览（yaml/manifest/schemas/constraints/regex）。
    """

    def compose(self) -> ComposeResult:
        """组装生成屏布局。"""
        with VerticalScroll():
            yield Label("AI 配置生成", classes="title")
            yield Label("从数据文件分析并生成 Schema / Constraint / Regex 配置", id="hint")

            yield Label("数据文件（勾选要处理的文件）：")
            yield SelectionList[str](id="data-files")

            with Horizontal():
                yield Label("采样行数:")
                yield Input(value="100", id="sample-rows", type="integer")
            with Horizontal():
                yield Label("每列采样值:")
                yield Input(value="100", id="sample-values", type="integer")
            with Horizontal():
                yield Label("最大迭代:")
                yield Input(value="2", id="max-iterations", type="integer")
            with Horizontal():
                yield Label("生成 Regex:")
                yield Switch(value=False, id="generate-regex")
            with Horizontal():
                yield Label("Agent 模式:")
                yield Switch(value=True, id="agent-mode")

            with Horizontal():
                yield Button("生成预览 (Ctrl+G)", id="btn-generate", variant="primary")
                yield Button("应用写盘 (Ctrl+A)", id="btn-apply", variant="success")

            yield Static("就绪", id="status")

            with TabbedContent(id="preview-tabs"):
                with TabPane("YAML", id="tab-yaml"):
                    yield RichLog(id="preview-yaml", wrap=True, markup=False)
                with TabPane("Manifest", id="tab-manifest"):
                    yield RichLog(id="preview-manifest", wrap=True, markup=False)
                with TabPane("Schemas", id="tab-schemas"):
                    yield RichLog(id="preview-schemas", wrap=True, markup=False)
                with TabPane("Constraints", id="tab-constraints"):
                    yield RichLog(id="preview-constraints", wrap=True, markup=False)
                with TabPane("Regex", id="tab-regex"):
                    yield RichLog(id="preview-regex", wrap=True, markup=False)

    def on_mount(self) -> None:
        """挂载时扫描数据文件。"""
        files = self._refresh_data_files()
        if not files:
            self._set_status("未找到数据文件，请在项目 data/ 目录放置 .xlsx/.csv/.json")
        else:
            self._set_status(f"已扫描到 {len(files)} 个数据文件")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """按钮点击分发。"""
        if event.button.id == "btn-generate":
            self._do_generate()
        elif event.button.id == "btn-apply":
            self._apply_result()

    def action_generate(self) -> None:
        """快捷键 Ctrl+G：生成预览。"""
        self._do_generate()

    def _read_int(self, widget_id: str, default: int) -> int:
        """读取整数 Input，解析失败回退默认值。"""
        try:
            widget = self.query_one(f"#{widget_id}", Input)
            return int(widget.value)
        except Exception:
            return default

    def _read_bool(self, widget_id: str) -> bool:
        """读取 Switch 值。"""
        try:
            return self.query_one(f"#{widget_id}", Switch).value
        except Exception:
            return False

    def _do_generate(self) -> None:
        """触发异步生成。"""
        project_path = self.project_path
        if not project_path:
            self._set_status("未打开项目，请先用 open 打开项目")
            return

        # 读取选中的数据文件
        try:
            sel_list = self.query_one("#data-files", SelectionList)
            file_paths = list(sel_list.selected)
        except Exception:
            file_paths = []

        if not file_paths:
            # 未选则用全部扫描结果
            file_paths = self._service.scan_data_files(_EMPTY_PATTERNS, project_path)
        if not file_paths:
            self._set_status("未找到数据文件")
            return

        sample_rows = max(1, self._read_int("sample-rows", 100))
        sample_values = max(1, self._read_int("sample-values", 100))
        max_iterations = max(1, min(5, self._read_int("max-iterations", 2)))
        generate_regex = self._read_bool("generate-regex")
        agent_mode = self._read_bool("agent-mode")

        self._set_status("生成中…")
        self.run_worker(
            self._generate_task(
                file_paths=file_paths,
                sample_rows=sample_rows,
                sample_values=sample_values,
                max_iterations=max_iterations,
                generate_regex=generate_regex,
                agent_mode=agent_mode,
            ),
            exclusive=True,
        )

    async def _generate_task(
        self,
        *,
        file_paths: list[str],
        sample_rows: int,
        sample_values: int,
        max_iterations: int,
        generate_regex: bool,
        agent_mode: bool,
    ) -> None:
        """异步生成任务（在 worker 中运行）。"""
        try:
            result = await self._service.generate(
                file_paths=file_paths,
                project_name=self._project_name(),
                project_id=self._project_id(),
                config_path=self.project_path,
                agent_mode=agent_mode,
                max_iterations=max_iterations,
                sample_rows=sample_rows,
                sample_values_per_column=sample_values,
                generate_regex=generate_regex,
                on_progress=self._make_progress_callback(),
            )
        except Exception as e:
            logger.error("配置生成失败: %s", e, exc_info=True)
            self._set_status(f"生成失败: {e}")
            return

        if not result.get("success"):
            error = result.get("error") or "配置生成失败"
            self._set_status(f"生成失败: {error}")
            return

        self._last_result = result
        self._render_preview(result)
        warnings = result.get("warnings", []) or []
        suffix = f"（{len(warnings)} 条警告）" if warnings else ""
        self._set_status(f"生成完成{suffix}，可点「应用」写盘")


@register_screen("migrate")
class MigrateScreen(_GenerationScreenBase):
    """AI 配置迁移屏。

    布局：脚本路径 Input + 语言 Select + 数据文件多选 + 参数表单 + 预览 + 应用。
    """

    def compose(self) -> ComposeResult:
        """组装迁移屏布局。"""
        with VerticalScroll():
            yield Label("AI 配置迁移", classes="title")
            yield Label("从旧脚本（Python/SQL/Excel 公式/自然语言）迁移生成配置", id="hint")

            yield Label("脚本文件路径（相对项目根或绝对路径）:")
            yield Input(value="", id="script-path", placeholder="例如 scripts/legacy_rules.sql")

            yield Label("脚本语言:")
            yield Select(
                _MIGRATE_LANGUAGES,
                value="python",
                id="language",
                allow_blank=False,
            )

            yield Label("数据文件（勾选要处理的数据文件）:")
            yield SelectionList[str](id="data-files")

            with Horizontal():
                yield Label("采样行数:")
                yield Input(value="100", id="sample-rows", type="integer")
            with Horizontal():
                yield Label("每列采样值:")
                yield Input(value="100", id="sample-values", type="integer")
            with Horizontal():
                yield Label("最大迭代:")
                yield Input(value="2", id="max-iterations", type="integer")

            with Horizontal():
                yield Button("迁移预览 (Ctrl+G)", id="btn-generate", variant="primary")
                yield Button("应用写盘 (Ctrl+A)", id="btn-apply", variant="success")

            yield Static("就绪", id="status")

            with TabbedContent(id="preview-tabs"):
                with TabPane("YAML", id="tab-yaml"):
                    yield RichLog(id="preview-yaml", wrap=True, markup=False)
                with TabPane("Manifest", id="tab-manifest"):
                    yield RichLog(id="preview-manifest", wrap=True, markup=False)
                with TabPane("Schemas", id="tab-schemas"):
                    yield RichLog(id="preview-schemas", wrap=True, markup=False)
                with TabPane("Constraints", id="tab-constraints"):
                    yield RichLog(id="preview-constraints", wrap=True, markup=False)
                with TabPane("Regex", id="tab-regex"):
                    yield RichLog(id="preview-regex", wrap=True, markup=False)

    def on_mount(self) -> None:
        """挂载时扫描数据文件。"""
        files = self._refresh_data_files()
        if not files:
            self._set_status("未找到数据文件，请在项目 data/ 目录放置 .xlsx/.csv/.json")
        else:
            self._set_status(f"已扫描到 {len(files)} 个数据文件")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """按钮点击分发。"""
        if event.button.id == "btn-generate":
            self._do_migrate()
        elif event.button.id == "btn-apply":
            self._apply_result()

    def action_generate(self) -> None:
        """快捷键 Ctrl+G：迁移预览。"""
        self._do_migrate()

    def _read_int(self, widget_id: str, default: int) -> int:
        """读取整数 Input，解析失败回退默认值。"""
        try:
            widget = self.query_one(f"#{widget_id}", Input)
            return int(widget.value)
        except Exception:
            return default

    def _do_migrate(self) -> None:
        """触发异步迁移。"""
        project_path = self.project_path
        if not project_path:
            self._set_status("未打开项目，请先用 open 打开项目")
            return

        # 读取脚本路径
        try:
            script_input = self.query_one("#script-path", Input)
            script_path = script_input.value.strip()
        except Exception:
            script_path = ""
        if not script_path:
            self._set_status("请填写脚本文件路径")
            return

        # 解析为绝对路径
        if not os.path.isabs(script_path):
            script_path = os.path.join(project_path, script_path)
        if not os.path.exists(script_path):
            self._set_status(f"脚本文件不存在: {script_path}")
            return

        # 读取语言
        try:
            language = str(self.query_one("#language", Select).value)
        except Exception:
            language = "python"

        # 读取选中的数据文件
        try:
            sel_list = self.query_one("#data-files", SelectionList)
            file_paths = list(sel_list.selected)
        except Exception:
            file_paths = []
        if not file_paths:
            file_paths = self._service.scan_data_files(_EMPTY_PATTERNS, project_path)
        if not file_paths:
            self._set_status("未找到数据文件")
            return

        sample_rows = max(1, self._read_int("sample-rows", 100))
        sample_values = max(1, self._read_int("sample-values", 100))
        max_iterations = max(1, min(5, self._read_int("max-iterations", 2)))

        # 读取脚本内容
        try:
            with open(script_path, encoding="utf-8") as f:
                script_content = f.read()
        except Exception as e:
            self._set_status(f"读取脚本失败: {e}")
            return

        self._set_status("迁移中…")
        self.run_worker(
            self._migrate_task(
                script_content=script_content,
                language=language,
                file_paths=file_paths,
                sample_rows=sample_rows,
                sample_values=sample_values,
                max_iterations=max_iterations,
            ),
            exclusive=True,
        )

    async def _migrate_task(
        self,
        *,
        script_content: str,
        language: str,
        file_paths: list[str],
        sample_rows: int,
        sample_values: int,
        max_iterations: int,
    ) -> None:
        """异步迁移任务（在 worker 中运行）。"""
        try:
            result = await self._service.migrate(
                script_content=script_content,
                language=language,
                file_paths=file_paths,
                project_name=self._project_name(),
                project_id=self._project_id(),
                config_path=self.project_path,
                max_iterations=max_iterations,
                sample_rows=sample_rows,
                sample_values_per_column=sample_values,
                on_progress=self._make_progress_callback(),
            )
        except Exception as e:
            logger.error("配置迁移失败: %s", e, exc_info=True)
            self._set_status(f"迁移失败: {e}")
            return

        if not result.get("success"):
            error = result.get("error") or "配置迁移失败"
            self._set_status(f"迁移失败: {error}")
            return

        self._last_result = result
        self._render_preview(result)
        warnings = result.get("warnings", []) or []
        suffix = f"（{len(warnings)} 条警告）" if warnings else ""
        self._set_status(f"迁移完成{suffix}，可点「应用」写盘")


__all__ = ["GenerateScreen", "MigrateScreen"]
