# backend/app/cli/shared_services/config_ops.py
"""
@fileoverview 配置操作共享逻辑（CLI/TUI 同源）

功能概述:
- 收敛 config show/get/set/list/check 共用的纯业务逻辑：
  配置文件定位、点号路径读写、值类型解析、YAML 语法检查
- 供 CLI 的 config 子命令与未来 TUI 的 config 屏共同调用，确保「改一处即可」

架构设计:
- 本模块只含纯逻辑与文件 IO，不含任何 UI/渲染
- check_yaml_syntax 只负责「检查 + 收集错误位置/上下文/建议」，rich.Syntax 渲染留在各 UI 层
- find_config_file 含路径穿越防护（原 config/base.py 逻辑）

接口契约（P0b 冻结）:
    def find_config_file(project_path: str, name: str | None) -> str | None
    def get_by_dotpath(data: dict, key_path: str) -> tuple[bool, Any]
    def set_by_dotpath(data: dict, key_path: str, value: Any) -> dict
    def parse_config_value(value_str: str) -> tuple[bool, Any, str]
    def list_config_files(project_path: str) -> list[ConfigFileInfo]
    def load_config_content(project_path: str, filename: str) -> dict | str
    def check_yaml_syntax(content: str, filename: str) -> YamlCheckResult
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

import yaml

from app.shared.core.utils.path_utils import paths_equal

logger = logging.getLogger(__name__)


@dataclass
class ConfigFileInfo:
    """单个配置文件的信息（list 子命令用）。

    Attributes:
        name: 相对项目根的显示名（根目录文件为文件名，子目录文件为相对路径）
        size: 文件大小（字节）
        path: 文件绝对路径
    """

    name: str
    size: int
    path: str


@dataclass
class YamlCheckResult:
    """YAML 语法检查结果（check 子命令用，纯逻辑，不含渲染）。

    Attributes:
        file: 文件名
        valid: 是否通过语法检查
        line_no: 错误所在行号（1-based）；无位置信息或通过时为 None
        snippet: 错误附近的代码片段（纯文本，无高亮）；无则 None
        problem: 简化后的问题描述；无则 None
        hint: 修复建议；无则 None
    """

    file: str
    valid: bool
    line_no: int | None
    snippet: str | None
    problem: str | None
    hint: str | None


def find_config_file(project_path: str, filename: str | None) -> str | None:
    """查找配置文件。

    首先尝试直接拼接路径，如果失败则在项目目录下递归查找。
    包含路径穿越防护，验证输入路径的合法性。

    Args:
        project_path: 项目根目录路径
        filename: 文件名（可能包含子目录）；为 None 或空时返回 None

    Returns:
        文件的完整路径，如果未找到则返回 None

    Security:
        - 验证 project_path 是合法目录
        - 验证 filename 不包含路径分隔符或父目录引用
        - 解析后的文件路径必须在 project_path 范围内
    """
    # 验证 project_path 是合法目录
    if not project_path or not isinstance(project_path, str):
        return None

    project_path = os.path.realpath(project_path)
    if not os.path.isdir(project_path):
        return None

    # 验证 filename 不包含危险字符（路径穿越防护）
    if not filename or not isinstance(filename, str):
        return None

    # 禁止绝对路径和父目录引用
    if os.path.isabs(filename):
        return None
    if ".." in filename or filename.startswith("~"):
        return None

    # 首先尝试直接路径
    direct_path = os.path.normpath(os.path.join(project_path, filename))

    # 确保解析后的路径在项目目录范围内
    if not direct_path.startswith(project_path):
        return None

    if os.path.isfile(direct_path):
        return direct_path

    # 如果直接路径不存在，递归查找
    for root, _, files in os.walk(project_path):
        # 跳过隐藏目录
        if any(part.startswith(".") for part in root.split(os.sep)):
            continue
        # 检查文件名是否匹配
        if os.path.basename(filename) in files:
            full_path = os.path.join(root, os.path.basename(filename))
            # 验证找到的完整路径在项目范围内
            if os.path.realpath(full_path).startswith(project_path):
                return full_path
        # 也检查完整路径匹配
        for f in files:
            rel_path = os.path.relpath(os.path.join(root, f), project_path)
            if paths_equal(rel_path, filename):
                full_path = os.path.join(root, f)
                # 验证找到的完整路径在项目范围内
                if os.path.realpath(full_path).startswith(project_path):
                    return full_path

    return None


def get_by_dotpath(data: dict, key_path: str) -> tuple[bool, Any]:
    """按点号路径从字典中查找值。

    Args:
        data: 配置字典
        key_path: 点号路径，如 "project.name"

    Returns:
        (找到, 值)；未找到时返回 (False, None)
    """
    keys = key_path.split(".")
    value: Any = data
    for key in keys:
        if isinstance(value, dict) and key in value:
            value = value[key]
        else:
            return False, None
    return True, value


def set_by_dotpath(data: dict, key_path: str, value: Any) -> dict:
    """按点号路径写入值，返回新 data（不改原 dict）。

    中间层级不存在时自动创建空字典。

    Args:
        data: 原配置字典（不会被修改）
        key_path: 点号路径，如 "project.name"
        value: 要写入的值

    Returns:
        写入后的新字典（深拷贝原 data 后写入）
    """
    # 深拷贝避免修改原 dict（YAML 配置是 JSON 安全数据，用 JSON 拷贝即可）
    import copy

    new_data = copy.deepcopy(data) if data else {}
    keys = key_path.split(".")
    current = new_data
    for key in keys[:-1]:
        if key not in current or not isinstance(current[key], dict):
            current[key] = {}
        current = current[key]
    current[keys[-1]] = value
    return new_data


def parse_config_value(value_str: str) -> tuple[bool, Any, str]:
    """解析字符串值为合适的类型。

    按以下顺序尝试转换：
    1. 布尔值（true/false）
    2. null（null/none）
    3. 整数
    4. 浮点数
    5. 去除引号的字符串
    6. YAML 列表或字典
    7. 原样字符串

    Args:
        value_str: 原始字符串值

    Returns:
        (成功, 转换后的值, 错误信息)；本实现始终成功，错误信息为空字符串。
        保留 tuple 三元组以匹配接口契约，便于未来扩展严格模式。
    """
    # 尝试布尔值
    if value_str.lower() == "true":
        return True, True, ""
    if value_str.lower() == "false":
        return True, False, ""
    if value_str.lower() == "null" or value_str.lower() == "none":
        return True, None, ""

    # 尝试整数
    try:
        return True, int(value_str), ""
    except ValueError:
        pass

    # 尝试浮点数
    try:
        return True, float(value_str), ""
    except ValueError:
        pass

    # 去除引号
    if (value_str.startswith('"') and value_str.endswith('"')) or (
        value_str.startswith("'") and value_str.endswith("'")
    ):
        return True, value_str[1:-1], ""

    # 尝试 YAML 列表或对象
    try:
        parsed = yaml.safe_load(value_str)
        if isinstance(parsed, (list, dict)):
            return True, parsed, ""
    except Exception:
        logger.debug("解析 YAML 值失败: %s", value_str, exc_info=True)

    # 默认返回字符串
    return True, value_str, ""


def list_config_files(project_path: str) -> list[ConfigFileInfo]:
    """扫描项目中的所有 YAML 配置文件。

    先扫描项目根目录，再递归扫描 schemas/constraints/patterns/regex 子目录。

    Args:
        project_path: 项目根目录绝对路径

    Returns:
        配置文件信息列表，按名称排序
    """
    config_files: list[ConfigFileInfo] = []

    # 根目录
    for f in os.listdir(project_path):
        if f.endswith((".yaml", ".yml")):
            config_path = os.path.join(project_path, f)
            try:
                stat = os.stat(config_path)
                config_files.append(ConfigFileInfo(name=f, size=stat.st_size, path=config_path))
            except Exception:
                logging.error("获取文件信息失败", exc_info=True)

    # 递归子目录
    subdirs = ["schemas", "constraints", "patterns", "regex"]
    for subdir in subdirs:
        subdir_path = os.path.join(project_path, subdir)
        if os.path.isdir(subdir_path):
            for root, _, files in os.walk(subdir_path):
                for f in files:
                    if f.endswith((".yaml", ".yml")):
                        rel_path = os.path.relpath(os.path.join(root, f), project_path)
                        config_path = os.path.join(root, f)
                        try:
                            stat = os.stat(config_path)
                            config_files.append(ConfigFileInfo(name=rel_path, size=stat.st_size, path=config_path))
                        except Exception:
                            pass

    # 按名称排序
    config_files.sort(key=lambda x: x.name)
    return config_files


def load_config_content(project_path: str, filename: str) -> dict | str:
    """读取单个配置文件内容。

    Args:
        project_path: 项目根目录绝对路径
        filename: 配置文件名（相对项目根）

    Returns:
        解析后的 dict；文件不存在时返回错误描述字符串；
        文件为空时返回 "(空文件)"；读取失败时返回 "(读取失败: ...)"。
    """
    config_path = find_config_file(project_path, filename)
    if not config_path:
        return f"配置文件不存在: {filename}"
    try:
        with open(config_path, encoding="utf-8") as f:
            content = yaml.safe_load(f)
            if content:
                return content if isinstance(content, dict) else str(content)
            return "(空文件)"
    except yaml.YAMLError as e:
        return f"YAML 解析失败: {e}"
    except Exception as e:
        return f"读取失败: {e}"


def _simplify_error_message(msg: str) -> str:
    """将技术性的错误信息转换为更友好的描述。

    Args:
        msg: 原始错误信息

    Returns:
        翻译后的中文描述，如果没有匹配则返回原文
    """
    translations = {
        "expected '<document start>', but found": "期望文件开始标记，但实际发现",
        "expected <block end>, but found": "期望块结束，但实际发现",
        "expected ',' or ']', but got": "期望逗号或右括号，但实际得到",
        "while parsing a block mapping": "解析对象/字典时出错",
        "while parsing a block collection": "解析列表/数组时出错",
        "mapping values are not allowed here": "此处不允许键值对（可能缺少冒号或缩进错误）",
        "could not determine a constructor for the tag": "无法识别的标签类型",
        "found character": "发现不期望的字符",
        "that cannot start any token": "无法作为任何标记的开始",
        "unacceptable character": "包含不可接受的字符（可能是编码问题）",
    }

    for tech, friendly in translations.items():
        if tech.lower() in msg.lower():
            return friendly

    return msg


def check_yaml_syntax(content: str, filename: str) -> YamlCheckResult:
    """检查 YAML 文本语法，返回纯逻辑结果（不含 rich 渲染）。

    Args:
        content: 文件原始文本内容
        filename: 文件名（用于结果记录）

    Returns:
        YamlCheckResult：包含 valid/行号/代码片段/问题描述/修复建议。
        代码片段为纯文本（错误行附近 ±2 行），rich.Syntax 高亮由调用方自行渲染。
    """
    content_lines = content.split("\n")

    try:
        yaml.safe_load(content)
        return YamlCheckResult(
            file=filename,
            valid=True,
            line_no=None,
            snippet=None,
            problem=None,
            hint=None,
        )
    except yaml.YAMLError as e:
        # 获取错误位置
        problem_mark = getattr(e, "problem_mark", None)
        error_line_no = problem_mark.line if problem_mark else None  # 0-based

        # 代码片段（纯文本，错误行附近 ±2 行）
        snippet: str | None = None
        if error_line_no is not None:
            context_start = max(0, error_line_no - 2)
            context_end = min(len(content_lines), error_line_no + 3)
            snippet_lines = content_lines[context_start:context_end]
            # 1-based 起始行号标注在每行前，便于 UI 渲染
            start_line = context_start + 1
            snippet = "\n".join(f"{start_line + idx:>4} | {line}" for idx, line in enumerate(snippet_lines))

        # 问题与上下文描述
        problem: str | None = None
        if hasattr(e, "problem") and e.problem:
            problem = _simplify_error_message(e.problem)

        if hasattr(e, "context") and e.context:
            context = _simplify_error_message(e.context)
            problem = f"{problem}（上下文: {context}）" if problem else context

        # 修复建议
        hint: str | None = None
        problem_str = str(getattr(e, "problem", "")).lower()
        context_str = str(getattr(e, "context", "")).lower()

        if "block end" in problem_str and "scalar" in problem_str:
            hint = "可能是上一行缺少冒号，或括号/引号不匹配"
            # 检查前一行的内容
            if error_line_no is not None and error_line_no > 0:
                prev_line = content_lines[error_line_no - 1].strip()
                if "required" in prev_line and ":" not in prev_line:
                    hint += f"；上一行 '{prev_line[:30]}...' 可能缺少冒号"
        elif "mapping" in context_str:
            hint = "检查键值对格式是否正确（key: value）"
        elif "could not determine a constructor" in problem_str:
            hint = "可能包含特殊字符或不支持的 YAML 语法"

        return YamlCheckResult(
            file=filename,
            valid=False,
            line_no=(error_line_no + 1) if error_line_no is not None else None,
            snippet=snippet,
            problem=problem,
            hint=hint,
        )


__all__ = [
    "ConfigFileInfo",
    "YamlCheckResult",
    "check_yaml_syntax",
    "find_config_file",
    "get_by_dotpath",
    "list_config_files",
    "load_config_content",
    "parse_config_value",
    "set_by_dotpath",
]
