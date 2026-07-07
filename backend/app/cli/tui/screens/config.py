# backend/app/cli/tui/screens/config.py
"""
@fileoverview TUI Config 管理屏（P3）

功能概述:
- 以 TabbedContent 承载 8 个 config 子命令的 TUI 版：list/show/get/set/check/
  inspect/init/edit
- 每个 Tab 对应一种配置操作，UI 层只做交互编排，业务逻辑全部委托
  ConfigService（其再委托 shared_services.config_ops / load_project）
- edit 用内置 TextArea widget 替代 CLI 的外部编辑器

架构设计:
- ConfigScreen 通过 register_screen("config") 注册到 SCREEN_REGISTRY（P6 装配）
- 通过 ProjectState 协议从 App 获取当前项目路径（未打开项目时各操作给出提示）
- service 在 __init__ 注入，便于测试时替换；默认用 ConfigService()
- 各 Tab 的输入用 Input/Select，输出用 DataTable/RichLog/Tree

复用（只读 import）:
- ConfigService — 本包 service 层（委托 config_ops + load_project）
- ProjectState — tui.protocols（项目状态协议）
- 模板类型常量经 ConfigService.render_template 间接复用
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import yaml
from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import (
    Button,
    DataTable,
    Input,
    Label,
    RichLog,
    Select,
    TabbedContent,
    TabPane,
    TextArea,
    Tree,
)
from textual.widgets.tree import TreeNode

from app.cli.tui.protocols import register_screen
from app.cli.tui.services.config_service import ConfigService, InspectionResult

if TYPE_CHECKING:
    from textual.widgets import Select as _Select  # noqa: F401


# 严重度展示标签（与 CLI inspect.py 风格一致，TUI 用纯文本避免 emoji 渲染问题）
_SEVERITY_LABEL = {
    "blocker": "[BLOCKER]",
    "warning": "[WARNING]",
    "info": "[INFO]",
}

# init 子命令可选的模板类型（与 ConfigService._TEMPLATES 对齐）
_TEMPLATE_OPTIONS = [
    ("Project (project.precis.yaml)", "project"),
    ("Constraint (constraints.yaml)", "constraint"),
    ("Pattern (patterns.yaml)", "pattern"),
]


@register_screen("config")
class ConfigScreen(Screen):
    """Config 管理屏。

    通过 TabbedContent 承载 8 个 config 子命令的 TUI 版。每个 Tab 绑定一个
    操作按钮，点击后调用 ConfigService 完成业务并把结果渲染到对应输出区。
    """

    BINDINGS = [("escape", "app.pop_screen", "返回")]

    def __init__(self, service: ConfigService | None = None) -> None:
        """初始化 Config 屏。

        Args:
            service: 注入的 ConfigService（测试时可替换）；为 None 时用默认实例。
        """
        super().__init__()
        self._service = service or ConfigService()

    # ------------------------------------------------------------------
    # 项目状态访问
    # ------------------------------------------------------------------

    @property
    def _project_path(self) -> str | None:
        """从 App 读取当前项目路径（实现 ProjectState 协议的对象）。

        App 持有 project_path 属性即满足 ProjectState 协议；未打开项目时返回 None。
        """
        app_obj: Any = self.app
        return getattr(app_obj, "project_path", None)

    def _ensure_project_open(self) -> str | None:
        """校验项目已打开，返回项目路径；未打开时在各输出区给出提示并返回 None。"""
        path = self._project_path
        if not path:
            self._notify("未打开项目，请先使用 open 命令打开项目")
            return None
        return path

    def _notify(self, message: str) -> None:
        """向用户展示一条提示（用 app.notify，TUI 标准通知机制）。"""
        try:
            self.app.notify(message)
        except Exception:  # noqa: BLE001 — 通知失败不应中断业务流程
            pass

    # ------------------------------------------------------------------
    # 布局
    # ------------------------------------------------------------------

    def compose(self) -> ComposeResult:
        """组装 8 个 Tab 的布局。

        每个 TabPane 内嵌一个 Vertical 容器（含标签/输入/输出控件）。
        """
        with TabbedContent(id="config-tabs"):
            with TabPane("list", id="tab-list"):
                yield Vertical(
                    Label("列出项目中所有 YAML 配置文件"),
                    Button("刷新列表", id="list-refresh"),
                    DataTable(id="list-table", cursor_type="row"),
                )
            with TabPane("show", id="tab-show"):
                yield Vertical(
                    Label("显示配置文件内容（留空显示默认配置）"),
                    Horizontal(
                        Input(placeholder="文件名，如 project.precis.yaml", id="show-file"),
                        Button("显示", id="show-run"),
                    ),
                    RichLog(id="show-output", highlight=True, markup=True),
                )
            with TabPane("get", id="tab-get"):
                yield Vertical(
                    Label("按点号路径获取配置项值（如 project.name）"),
                    Horizontal(
                        Input(placeholder="配置文件", id="get-file", value="project.precis.yaml"),
                        Input(placeholder="点号路径 key", id="get-key"),
                        Button("查询", id="get-run"),
                    ),
                    RichLog(id="get-output", highlight=True, markup=True),
                )
            with TabPane("set", id="tab-set"):
                yield Vertical(
                    Label("按点号路径设置配置项值（自动推断类型）"),
                    Horizontal(
                        Input(placeholder="配置文件", id="set-file", value="project.precis.yaml"),
                        Input(placeholder="点号路径 key", id="set-key"),
                        Input(placeholder="值", id="set-value"),
                        Button("设置", id="set-run"),
                    ),
                    RichLog(id="set-output", highlight=True, markup=True),
                )
            with TabPane("check", id="tab-check"):
                yield Vertical(
                    Label("检查 YAML 语法（留空扫描全部文件）"),
                    Horizontal(
                        Input(placeholder="文件名（可选）", id="check-file"),
                        Button("检查", id="check-run"),
                    ),
                    DataTable(id="check-table", cursor_type="row"),
                    RichLog(id="check-detail", highlight=True, markup=True),
                )
            with TabPane("inspect", id="tab-inspect"):
                yield Vertical(
                    Label("配置跨文件一致性自检（按严重度分组）"),
                    Button("执行自检", id="inspect-run"),
                    Tree("自检结果", id="inspect-tree"),
                )
            with TabPane("init", id="tab-init"):
                yield Vertical(
                    Label("基于模板创建新配置文件"),
                    Horizontal(
                        Label("模板类型:"),
                        Select(_TEMPLATE_OPTIONS, id="init-type", value="project"),
                    ),
                    Horizontal(
                        Label("文件名（留空用默认）:"),
                        Input(placeholder="默认文件名", id="init-filename"),
                    ),
                    Horizontal(
                        Button("预览", id="init-preview"),
                        Button("创建", id="init-create"),
                    ),
                    RichLog(id="init-output", highlight=True, markup=True),
                )
            with TabPane("edit", id="tab-edit"):
                yield Vertical(
                    Label("用内置编辑器修改配置文件"),
                    Horizontal(
                        Input(placeholder="文件名", id="edit-file", value="project.precis.yaml"),
                        Button("加载", id="edit-load"),
                        Button("保存", id="edit-save"),
                    ),
                    TextArea(id="edit-area", language="yaml", theme="monokai", soft_wrap=False),
                )

    # ------------------------------------------------------------------
    # 事件处理
    # ------------------------------------------------------------------

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """分发按钮点击到对应处理方法。"""
        handler = {
            "list-refresh": self._action_list_refresh,
            "show-run": self._action_show,
            "get-run": self._action_get,
            "set-run": self._action_set,
            "check-run": self._action_check,
            "inspect-run": self._action_inspect,
            "init-preview": self._action_init_preview,
            "init-create": self._action_init_create,
            "edit-load": self._action_edit_load,
            "edit-save": self._action_edit_save,
        }.get(event.button.id)
        if handler is not None:
            handler()

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        """check 表格行被选中时展开该文件的检查详情。"""
        if event.data_table.id == "check-table":
            self._show_check_detail(event.row_key)

    # ------------------------------------------------------------------
    # 各 Tab 的动作处理
    # ------------------------------------------------------------------

    def _action_list_refresh(self) -> None:
        """list：刷新配置文件列表。"""
        path = self._ensure_project_open()
        table = self.query_one("#list-table", DataTable)
        table.clear(columns=True)
        table.add_column("文件名", width=40)
        table.add_column("大小", width=12)
        if path is None:
            return
        files = self._service.list_files(path)
        if not files:
            self._notify("暂无配置文件")
            return
        for info in files:
            table.add_row(info.name, self._format_size(info.size))

    def _action_show(self) -> None:
        """show：显示配置文件内容。"""
        path = self._ensure_project_open()
        log = self.query_one("#show-output", RichLog)
        log.clear()
        if path is None:
            return
        filename = self.query_one("#show-file", Input).value.strip()
        if filename:
            self._show_single_file(path, filename, log)
        else:
            self._show_default_files(path, log)

    def _show_single_file(self, project_path: str, filename: str, log: RichLog) -> None:
        """显示单个配置文件。

        用 config_ops.load_config_content 读内容（get_value 只取单值，show 需要整文件）。
        """
        from app.cli.shared_services.config_ops import load_config_content

        log.write(f"--- {filename} ---")
        data = load_config_content(project_path, filename)
        if isinstance(data, dict | list):
            log.write(yaml.dump(data, allow_unicode=True, default_flow_style=False))
        else:
            # 字符串：空文件 / 不存在 / 读取失败描述
            log.write(str(data))

    def _show_default_files(self, project_path: str, log: RichLog) -> None:
        """显示一组默认配置文件（与 CLI show.py 一致）。"""
        from app.cli.shared_services.config_ops import load_config_content

        default_files = [
            "project.precis.yaml",
            "constraints.yaml",
            "patterns.yaml",
            "regex.yaml",
        ]
        log.write("项目配置文件:")
        for name in default_files:
            data = load_config_content(project_path, name)
            if isinstance(data, dict | list):
                log.write(f"\n--- {name} ---")
                log.write(yaml.dump(data, allow_unicode=True, default_flow_style=False))
            elif isinstance(data, str) and not data.startswith("配置文件不存在"):
                # 空文件等非致命描述
                log.write(f"\n--- {name} ---")
                log.write(data)

    def _action_get(self) -> None:
        """get：按点号路径查询配置项。"""
        path = self._ensure_project_open()
        log = self.query_one("#get-output", RichLog)
        log.clear()
        if path is None:
            return
        config_file = self.query_one("#get-file", Input).value.strip()
        key_path = self.query_one("#get-key", Input).value.strip()
        if not config_file or not key_path:
            self._notify("请填写配置文件与点号路径")
            return
        ok, value, err = self._service.get_value(path, config_file, key_path)
        if not ok:
            log.write(f"[red]{err}[/red]")
            return
        if isinstance(value, dict | list):
            formatted = yaml.dump(value, allow_unicode=True, default_flow_style=False)
        else:
            formatted = str(value)
        log.write(f"{key_path} = {formatted}")

    def _action_set(self) -> None:
        """set：按点号路径写入配置项。"""
        path = self._ensure_project_open()
        log = self.query_one("#set-output", RichLog)
        log.clear()
        if path is None:
            return
        config_file = self.query_one("#set-file", Input).value.strip()
        key_path = self.query_one("#set-key", Input).value.strip()
        value_str = self.query_one("#set-value", Input).value
        if not config_file or not key_path:
            self._notify("请填写配置文件与点号路径")
            return
        ok, msg = self._service.set_value(path, config_file, key_path, value_str)
        if ok:
            log.write(f"[green]{msg}[/green]")
        else:
            log.write(f"[red]{msg}[/red]")

    def _action_check(self) -> None:
        """check：检查 YAML 语法，结果填入表格。"""
        path = self._ensure_project_open()
        table = self.query_one("#check-table", DataTable)
        table.clear(columns=True)
        table.add_column("文件", width=36)
        table.add_column("有效", width=8)
        table.add_column("问题", width=60)
        if path is None:
            return
        filename = self.query_one("#check-file", Input).value.strip()
        files = [filename] if filename else None
        results = self._service.check_yaml(path, files)
        if not results:
            self._notify("未找到配置文件")
            return
        for r in results:
            valid_str = "是" if r.valid else "否"
            problem = r.problem or ("（语法正确）" if r.valid else "未知错误")
            table.add_row(r.file, valid_str, problem, key=r.file)

    def _show_check_detail(self, row_key: Any) -> None:
        """点击 check 表格行展开详情（行号/代码片段/修复建议）。"""
        path = self._project_path
        log = self.query_one("#check-detail", RichLog)
        log.clear()
        if not path:
            return
        # row_key 即文件名（_action_check 用 r.file 作 key）
        filename = str(row_key.value) if hasattr(row_key, "value") else str(row_key)
        results = self._service.check_yaml(path, [filename])
        if not results:
            return
        r = results[0]
        log.write(f"文件: {r.file}")
        log.write(f"有效: {'是' if r.valid else '否'}")
        if r.line_no is not None:
            log.write(f"行号: {r.line_no}")
        if r.snippet:
            log.write("\n代码片段:")
            log.write(r.snippet)
        if r.problem:
            log.write(f"\n问题: {r.problem}")
        if r.hint:
            log.write(f"建议: {r.hint}")

    def _action_inspect(self) -> None:
        """inspect：执行跨文件自检，结果填入 Tree（按 severity 分组）。"""
        path = self._ensure_project_open()
        tree = self.query_one("#inspect-tree", Tree)
        tree.reset("自检结果")
        if path is None:
            return
        import os

        manifest_path = os.path.join(path, "project.precis.yaml")
        if not os.path.isfile(manifest_path):
            alt = os.path.join(path, "project.precis.yml")
            if os.path.isfile(alt):
                manifest_path = alt
            else:
                self._notify("未找到 project.precis.yaml")
                return
        result = self._service.inspect(manifest_path)
        self._render_inspect_tree(tree, result)

    def _render_inspect_tree(self, tree: Tree, result: InspectionResult) -> None:
        """将 InspectionResult 渲染到 Tree（按 severity 分组）。"""
        # 按 severity 分组：blocker → warning → info
        severity_order = ["blocker", "warning", "info"]
        grouped: dict[str, list[Any]] = {s: [] for s in severity_order}
        for err in result.errors:
            sev = self._err_field(err, "severity") or "warning"
            grouped.setdefault(sev, []).append(err)

        has_blocker = result.has_blocker
        summary = f"自检完成（{'含阻塞错误' if has_blocker else '无阻塞'}）"
        root: TreeNode = tree.root
        root.set_label(summary)

        for sev in severity_order:
            group = grouped.get(sev, [])
            if not group:
                continue
            label = f"{_SEVERITY_LABEL.get(sev, sev)} （{len(group)}）"
            sev_node = root.add(label, expand=True)
            for err in group:
                title = self._err_field(err, "title") or self._err_field(err, "error_type") or "未知问题"
                err_node = sev_node.add_leaf(title)
                detail_lines: list[str] = []
                file_path = self._err_field(err, "file_path")
                if file_path:
                    detail_lines.append(f"文件: {file_path}")
                ref_id = self._err_field(err, "ref_id")
                if ref_id:
                    detail_lines.append(f"编号: {ref_id}")
                desc = self._err_field(err, "description") or self._err_field(err, "message")
                if desc:
                    detail_lines.append(f"说明: {desc}")
                fix_hint = self._err_field(err, "fix_hint") or self._err_field(err, "suggestion")
                if fix_hint:
                    detail_lines.append(f"建议: {fix_hint}")
                for line in detail_lines:
                    err_node.add_leaf(line)

        # 加载警告
        if result.warnings:
            warn_node = root.add(f"加载警告（{len(result.warnings)}）", expand=False)
            for w in result.warnings:
                warn_node.add_leaf(w)

        if not result.errors and not result.warnings:
            root.add_leaf("未发现问题")

    @staticmethod
    def _err_field(err: Any, name: str) -> Any:
        """从 LoadingError 实例或 dict 读取字段（兼容两种形态）。"""
        if isinstance(err, dict):
            return err.get(name)
        return getattr(err, name, None)

    def _action_init_preview(self) -> None:
        """init：预览模板内容。"""
        log = self.query_one("#init-output", RichLog)
        log.clear()
        template_type = self.query_one("#init-type", Select).value
        if not isinstance(template_type, str):
            self._notify("请选择模板类型")
            return
        project_name = self._project_name()
        try:
            filename, content = self._service.render_template(template_type, project_name)
        except ValueError as e:
            log.write(f"[red]{e}[/red]")
            return
        log.write(f"目标文件: {filename}")
        log.write("--- 模板内容 ---")
        log.write(content)

    def _action_init_create(self) -> None:
        """init：创建配置文件（落盘）。"""
        path = self._ensure_project_open()
        log = self.query_one("#init-output", RichLog)
        log.clear()
        if path is None:
            return
        template_type = self.query_one("#init-type", Select).value
        if not isinstance(template_type, str):
            self._notify("请选择模板类型")
            return
        project_name = self._project_name()
        try:
            default_filename, content = self._service.render_template(template_type, project_name)
        except ValueError as e:
            log.write(f"[red]{e}[/red]")
            return
        custom = self.query_one("#init-filename", Input).value.strip()
        filename = custom or default_filename
        import os

        filepath = os.path.join(path, filename)
        if os.path.exists(filepath):
            log.write(f"[red]文件已存在: {filename}（如需覆盖请先删除）[/red]")
            return
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            log.write(f"[green]已创建配置文件: {filename}[/green]")
        except OSError as e:
            log.write(f"[red]创建文件失败: {e}[/red]")

    def _action_edit_load(self) -> None:
        """edit：加载配置文件到 TextArea。"""
        path = self._ensure_project_open()
        if path is None:
            return
        filename = self.query_one("#edit-file", Input).value.strip()
        if not filename:
            self._notify("请填写文件名")
            return
        from app.cli.shared_services.config_ops import find_config_file

        config_path = find_config_file(path, filename)
        if not config_path:
            self._notify(f"配置文件不存在: {filename}")
            return
        try:
            with open(config_path, encoding="utf-8") as f:
                content = f.read()
        except OSError as e:
            self._notify(f"读取失败: {e}")
            return
        self.query_one("#edit-area", TextArea).load_text(content)
        self._notify(f"已加载: {filename}")

    def _action_edit_save(self) -> None:
        """edit：保存 TextArea 内容回配置文件。"""
        path = self._ensure_project_open()
        if path is None:
            return
        filename = self.query_one("#edit-file", Input).value.strip()
        if not filename:
            self._notify("请填写文件名")
            return
        from app.cli.shared_services.config_ops import find_config_file

        config_path = find_config_file(path, filename)
        if not config_path:
            self._notify(f"配置文件不存在: {filename}")
            return
        content = self.query_one("#edit-area", TextArea).text
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                f.write(content)
            self._notify(f"已保存: {filename}")
        except OSError as e:
            self._notify(f"保存失败: {e}")

    # ------------------------------------------------------------------
    # 辅助
    # ------------------------------------------------------------------

    def _project_name(self) -> str:
        """推断项目显示名（目录名），用于填充模板。"""
        import os

        path = self._project_path
        if path:
            return os.path.basename(path.rstrip(os.sep)) or path
        return "NewProject"

    @staticmethod
    def _format_size(size: int) -> str:
        """格式化文件大小为人类可读字符串（与 CLI list.py 一致）。"""
        if size < 1024:
            return f"{size}B"
        elif size < 1024 * 1024:
            return f"{size / 1024:.1f}KB"
        else:
            return f"{size / (1024 * 1024):.1f}MB"
