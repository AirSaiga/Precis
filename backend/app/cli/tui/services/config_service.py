# backend/app/cli/tui/services/config_service.py
"""
@fileoverview TUI Config 管理 service（P3）

功能概述:
- 薄包装层：委托 shared_services.config_ops（CLI/TUI 同源）完成配置文件的
  list/show/get/set/check 纯逻辑，自身只负责 IO 编排与结果归集
- inspect 委托 app.shared.core.project.loader.load_project，收集跨文件一致性错误
- init 渲染内置模板（project/constraint/pattern），返回 (默认文件名, 内容) 供屏落盘

架构设计:
- 本 service 不持有任何 UI 引用，所有方法返回纯数据/数据类，便于在 mock 边界独立测试
- 复用清单（只读 import，不修改）：
    * shared_services.config_ops — 点号查找/写入/值解析/YAML 检查/文件扫描/读内容
    * load_project — inspect 子命令的跨文件自检引擎
    * config/base.py 模板常量 — init 子命令的模板字符串

接口契约:
    InspectionResult: errors / warnings / has_blocker
    ConfigService:
        list_files(project_path) -> list[ConfigFileInfo]
        get_value(project_path, config_file, key_path) -> tuple[bool, Any, str]
        set_value(project_path, config_file, key_path, value_str) -> tuple[bool, str]
        check_yaml(project_path, files=None) -> list[YamlCheckResult]
        inspect(manifest_path) -> InspectionResult
        render_template(template_type, project_name) -> tuple[str, str]
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import yaml

from app.cli.shared_services.config_ops import (
    ConfigFileInfo,
    YamlCheckResult,
    check_yaml_syntax,
    find_config_file,
    get_by_dotpath,
    list_config_files,
    parse_config_value,
    set_by_dotpath,
)
from app.cli.shell.commands.config.base import (
    CONSTRAINT_TEMPLATE,
    PATTERNS_TEMPLATE,
    PROJECT_TEMPLATE,
)

# inspect 子命令复用核心加载器（与 CLI inspect.py 同源）
from app.shared.core.project.loader.loader_parts.main import load_project


@dataclass
class InspectionResult:
    """配置自检结果（inspect 子命令用）。

    封装 load_project 收集的跨文件一致性错误与加载警告，供屏按 severity 分组渲染。

    Attributes:
        errors: 加载错误列表（每个含 severity/title/description/fix_hint 等字段）
        warnings: 加载警告字符串列表
        has_blocker: 是否存在 severity == "blocker" 的错误；为 True 时项目不可校验
        manifest_path: 自检所用的 manifest 路径（用于错误回显）
    """

    errors: list[Any] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    has_blocker: bool = False
    manifest_path: str = ""


# 模板类型映射：类型 -> (默认文件名, 模板内容)。与 CLI init.py 保持一致。
_TEMPLATES: dict[str, tuple[str, str]] = {
    "project": ("project.precis.yaml", PROJECT_TEMPLATE),
    "constraint": ("constraints.yaml", CONSTRAINT_TEMPLATE),
    "pattern": ("patterns.yaml", PATTERNS_TEMPLATE),
    "patterns": ("patterns.yaml", PATTERNS_TEMPLATE),
}


class ConfigService:
    """TUI Config 管理 service。

    各方法均为纯逻辑薄包装：接收 UI 输入，委托 shared_services / core 完成业务，
    返回结果给屏渲染。不持有 UI 引用，便于独立单元测试。
    """

    def list_files(self, project_path: str) -> list[ConfigFileInfo]:
        """列出项目中所有 YAML 配置文件（委托 config_ops.list_config_files）。

        Args:
            project_path: 项目根目录绝对路径

        Returns:
            配置文件信息列表（含 name/size/path），按名称排序
        """
        return list_config_files(project_path)

    def get_value(self, project_path: str, config_file: str, key_path: str) -> tuple[bool, Any, str]:
        """按点号路径读取配置项值。

        Args:
            project_path: 项目根目录绝对路径
            config_file: 配置文件名（相对项目根）
            key_path: 点号路径，如 "project.name"

        Returns:
            (成功, 值, 错误信息)；成功为 False 时值为 None、第三项为错误描述。
            值为 dict/list 时返回原始对象，由调用方自行格式化。
        """
        config_path = find_config_file(project_path, config_file)
        if not config_path:
            return False, None, f"配置文件不存在: {config_file}"

        try:
            with open(config_path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            return False, None, f"YAML 解析失败: {e}"
        except OSError as e:
            return False, None, f"读取失败: {e}"

        if data is None:
            return False, None, "配置文件为空"

        found, value = get_by_dotpath(data, key_path)
        if not found:
            return False, None, f"配置项不存在: {key_path}"
        return True, value, ""

    def set_value(self, project_path: str, config_file: str, key_path: str, value_str: str) -> tuple[bool, str]:
        """按点号路径写入配置项值并落盘。

        解析 value_str（委托 config_ops.parse_config_value），按点号路径写入
        （委托 config_ops.set_by_dotpath，不改原 dict），最后 YAML 序列化写回文件。

        Args:
            project_path: 项目根目录绝对路径
            config_file: 配置文件名（相对项目根）
            key_path: 点号路径，如 "project.name"
            value_str: 原始字符串值（自动推断 bool/int/float/list/dict/str）

        Returns:
            (成功, 消息)；成功时消息形如 "已设置: key = value"，
            失败时为错误描述。
        """
        config_path = find_config_file(project_path, config_file)
        if not config_path:
            return False, f"配置文件不存在: {config_file}"

        try:
            with open(config_path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except yaml.YAMLError as e:
            return False, f"YAML 解析失败: {e}"
        except OSError as e:
            return False, f"读取失败: {e}"

        # 解析值（委托 shared_services 纯逻辑，CLI/TUI 同源）
        ok, value, parse_err = parse_config_value(value_str)
        if not ok:
            return False, f"值解析失败: {parse_err}"

        # 按点号路径写入（返回新 dict，不改原 data）
        new_data = set_by_dotpath(data, key_path, value)

        # 写回文件
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                yaml.dump(new_data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
        except OSError as e:
            return False, f"写入失败: {e}"

        return True, f"已设置: {key_path} = {value}"

    def check_yaml(self, project_path: str, files: list[str] | None = None) -> list[YamlCheckResult]:
        """检查 YAML 配置文件语法。

        Args:
            project_path: 项目根目录绝对路径
            files: 要检查的文件名列表（相对项目根）；为 None 时扫描项目全部 YAML 文件

        Returns:
            各文件的检查结果列表（含 valid/line_no/snippet/problem/hint）
        """
        results: list[YamlCheckResult] = []

        if files:
            # 指定文件：逐个检查
            for name in files:
                config_path = find_config_file(project_path, name)
                if not config_path:
                    results.append(
                        YamlCheckResult(
                            file=name,
                            valid=False,
                            line_no=None,
                            snippet=None,
                            problem=f"配置文件不存在: {name}",
                            hint=None,
                        )
                    )
                    continue
                results.append(self._check_one(config_path, name))
        else:
            # 全项目扫描：复用 list_config_files 的扫描结果
            for info in list_config_files(project_path):
                rel_name = os.path.relpath(info.path, project_path)
                results.append(self._check_one(info.path, rel_name))

        return results

    def inspect(self, manifest_path: str) -> InspectionResult:
        """执行配置跨文件一致性自检（委托 load_project）。

        load_project 内部已运行 inspect_config，结果在 loading_errors/warnings。
        本方法只负责收集与归一化，has_blocker = 任何 error 的 severity 为 blocker。

        Args:
            manifest_path: project.precis.yaml 的路径

        Returns:
            InspectionResult：含 errors/warnings/has_blocker。
            load_project 抛异常时（如完全损坏的 YAML）返回单条 blocker 错误。
        """
        try:
            loaded = load_project(manifest_path)
        except Exception as e:  # noqa: BLE001 — load_project 对损坏 manifest 会抛多种异常
            return InspectionResult(
                errors=[_make_blocker_error(str(manifest_path), str(e))],
                warnings=[],
                has_blocker=True,
                manifest_path=str(manifest_path),
            )

        errors: list[Any] = list(loaded.loading_errors or [])
        warnings: list[str] = list(loaded.warnings or [])
        has_blocker = any(getattr(e, "severity", "") == "blocker" for e in errors)

        return InspectionResult(
            errors=errors,
            warnings=warnings,
            has_blocker=has_blocker,
            manifest_path=str(manifest_path),
        )

    def render_template(self, template_type: str, project_name: str) -> tuple[str, str]:
        """渲染内置配置模板（init 子命令用）。

        Args:
            template_type: 模板类型，project / constraint / pattern（pattern == patterns）
            project_name: 项目名称，用于填充模板中的 {project_name} 占位符

        Returns:
            (默认文件名, 渲染后的内容)

        Raises:
            ValueError: 未知模板类型
        """
        key = template_type.lower()
        if key not in _TEMPLATES:
            available = ", ".join(["project", "constraint", "pattern"])
            raise ValueError(f"未知模板类型: {template_type}（可用: {available}）")

        default_filename, template = _TEMPLATES[key]
        # 仅 project 模板含 {project_name} 占位符；constraint/pattern 模板含正则大括号
        # （如 {2,}），直接 .format() 会误解析，故仅在含占位符时格式化。
        if "{project_name}" in template:
            content = template.format(project_name=project_name)
        else:
            content = template
        return default_filename, content

    @staticmethod
    def _check_one(config_path: str, display_name: str) -> YamlCheckResult:
        """检查单个 YAML 文件语法（委托 config_ops.check_yaml_syntax）。

        Args:
            config_path: 文件绝对路径
            display_name: 用于结果显示的文件名

        Returns:
            YamlCheckResult
        """
        try:
            with open(config_path, encoding="utf-8") as f:
                content = f.read()
        except OSError as e:
            return YamlCheckResult(
                file=display_name,
                valid=False,
                line_no=None,
                snippet=None,
                problem=f"读取文件失败: {e}",
                hint=None,
            )
        return check_yaml_syntax(content, display_name)


def _make_blocker_error(file_path: str, message: str) -> Any:
    """构造一条 blocker 级别的加载错误（load_project 抛异常时用）。

    使用 dict 而非 LoadingError 实例，避免与 core 类型耦合；
    inspect 屏只读 severity/title/description/fix_hint 等字段，dict 兼容。

    Args:
        file_path: manifest 路径
        message: 异常消息

    Returns:
        dict 形式的错误记录
    """
    return {
        "error_type": "ManifestLoadError",
        "file_path": file_path,
        "severity": "blocker",
        "title": "项目清单加载失败",
        "description": message,
        "fix_hint": "",
        "message": message,
        "ref_id": None,
        "suggestion": "",
    }


__all__ = ["ConfigService", "InspectionResult"]
