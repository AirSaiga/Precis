# backend/app/cli/shell/commands/ai/display.py
"""
@fileoverview AI 执行结果展示模块

功能概述:
- 显示 AI 修改文件的 diff 摘要与详细对比
- 区分新增、删除、修改三种文件状态并用颜色高亮
- 展示约束操作结果与数据校验结果（通过/失败）

架构设计:
- _show_diff_summary(): 显示文件变更摘要，询问是否查看详细 diff
- _display_detailed_diff(): 使用颜色高亮显示详细 diff 内容
- _display_execution_results(): 主入口，判断是否有文件修改并决定展示方式
- _display_results_without_diff(): 无文件修改时的结果展示（如仅执行校验）
- _display_constraint_results(): 分类显示校验结果与约束操作结果

输入示例:
    _display_execution_results(result, "/path/to/project", original_files_cache)

输出示例:
    带颜色高亮的 diff 与操作结果文本
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.cli.shell.formatter import Colors, Formatter

from .diff import _generate_diff

logger = logging.getLogger(__name__)


def _show_diff_summary(changed_files: dict[str, tuple[str, str]]) -> bool:
    """显示修改文件的 diff 摘要，并询问用户是否查看详细 diff。

    对每份修改的文件显示状态：新增（绿色）、删除（红色）、修改（黄色）。

    Args:
        changed_files: 字典，键为文件路径，值为 (旧内容, 新内容) 元组

    Returns:
        用户是否选择查看详细 diff
    """
    if not changed_files:
        return False

    print(Formatter.header("\n📋 修改文件摘要"))
    print("=" * 50)

    for file_path, (old_content, new_content) in changed_files.items():
        rel_path = Path(file_path).name
        if old_content == "":
            status = "新增"
            color = Colors.GREEN
        elif new_content == "":
            status = "删除"
            color = Colors.RED
        else:
            old_lines = len(old_content.splitlines())
            new_lines = len(new_content.splitlines())
            if old_lines == new_lines:
                status = "修改"
            else:
                status = f"修改 ({old_lines} → {new_lines} 行)"
            color = Colors.YELLOW

        print(f"  {Formatter.colorize(status, color)}: {rel_path}")

    print("=" * 50)

    try:
        response = input(Formatter.colorize("\n查看详细 diff? (y/N): ", Colors.YELLOW)).strip().lower()
        return response in ("y", "yes")
    except (KeyboardInterrupt, EOFError):
        print()
        return False


def _display_detailed_diff(changed_files: dict[str, tuple[str, str]]) -> None:
    """显示详细的 diff 内容。

    对 diff 的每一行进行颜色高亮：
    - 绿色：新增的行（以 + 开头）
    - 红色：删除的行（以 - 开头）
    - 青色：行号信息（以 @@ 开头）
    - 灰色：文件头信息（以 --- 或 +++ 开头）

    Args:
        changed_files: 字典，键为文件路径，值为 (旧内容, 新内容) 元组
    """
    print(Formatter.header("\n📄 详细 Diff"))
    print("=" * 70)

    has_diff = False
    for file_path, (old_content, new_content) in changed_files.items():
        diff_text = _generate_diff(file_path, old_content, new_content)
        if diff_text:
            has_diff = True
            rel_path = Path(file_path).name
            print(f"\n{Formatter.colorize('▶', Colors.CYAN)} {rel_path}")
            print("-" * 50)

            for line in diff_text.splitlines():
                if line.startswith("+"):
                    print(Formatter.colorize(line, Colors.GREEN))
                elif line.startswith("-"):
                    print(Formatter.colorize(line, Colors.RED))
                elif line.startswith("@@"):
                    print(Formatter.colorize(line, Colors.CYAN))
                elif line.startswith("---") or line.startswith("+++"):
                    print(Formatter.dim(line))
                else:
                    print(line)

    if not has_diff:
        print(Formatter.dim("  无内容变更"))

    print("\n" + "=" * 70)


def _display_execution_results(result, project_path: str, original_files_cache: dict[str, str] = None) -> None:
    """显示执行结果（CLI 交互模式）并处理 diff。

    判断 AI 返回的动作是否包含约束节点的增删改操作。
    如果有文件修改，则对比原始缓存生成 diff 并展示；
    如果没有文件修改（如仅执行校验），则只显示校验结果。

    Args:
        result: AIChatOrchestrator 的执行结果对象
        project_path: 项目路径
        original_files_cache: 原始文件内容缓存，用于 diff 对比
    """
    actions = result.actions
    original_files_cache = original_files_cache or {}

    # 判断是否有约束节点的增删改操作（这些操作会修改文件）
    has_modifications = any(
        a.get("actionType") in ["ADD_CONSTRAINT_NODE", "UPDATE_CONSTRAINT_NODE", "DELETE_CONSTRAINT_NODE"]
        for a in actions
    )

    if not has_modifications:
        _display_results_without_diff(result, project_path)
        return

    # 使用 orchestrator 已经执行的结果，避免重复执行 process_actions
    results = getattr(result, "action_results", [])

    # 收集修改后的文件内容，与原始缓存对比找出变更
    changed_files = {}
    for file_path, old_content in original_files_cache.items():
        try:
            if Path(file_path).exists():
                new_content = Path(file_path).read_text(encoding="utf-8")
            else:
                new_content = ""
            if old_content != new_content:
                changed_files[file_path] = (old_content, new_content)
        except Exception:
            logger.error("读取文件内容失败", exc_info=True)

    _display_constraint_results(results)

    if changed_files and _show_diff_summary(changed_files):
        _display_detailed_diff(changed_files)


def _display_results_without_diff(result, project_path: str) -> None:
    """显示没有修改操作的结果（仅校验等）。

    当 AI 的动作不涉及文件修改时（如 VALIDATE_PROJECT），
    直接显示校验结果而不进行 diff 对比。

    Args:
        result: AIChatOrchestrator 的执行结果对象
        project_path: 项目路径
    """
    results = getattr(result, "action_results", [])
    _display_constraint_results(results)


def _display_constraint_results(results: list[dict]) -> None:
    """显示约束操作结果。

    将动作结果分为两类：
    1. VALIDATE_PROJECT：数据校验结果（显示通过或错误详情）
    2. 其他约束操作：显示添加/更新/删除约束的成功或失败信息

    Args:
        results: 动作执行结果列表，每个元素是一个字典
    """
    # 分离校验结果与约束操作结果
    validate_results = [r for r in results if r.get("action", {}).get("actionType") == "VALIDATE_PROJECT"]
    constraint_results = [r for r in results if r.get("action", {}).get("actionType") != "VALIDATE_PROJECT"]

    # 显示校验结果
    for r in validate_results:
        msg = r.get("message", "")
        details = r.get("validate_details", {})
        has_errors = details.get("has_errors", False) if details else False
        action_spec = r.get("action", {}).get("constraintSpec", {})
        table_display = action_spec.get("tableName", "指定表")

        if has_errors:
            print(Formatter.warning("\n" + "=" * 50))
            print(Formatter.warning(f"⚠ 表 '{table_display}' 数据校验发现问题"))
            print(Formatter.warning("=" * 50))
            print(msg)
            print("=" * 50)
        else:
            print(Formatter.success("\n" + "=" * 50))
            print(Formatter.success(f"✓ 表 '{table_display}' 数据校验通过"))
            print(Formatter.success(f"  耗时: {details.get('duration_ms', 0)}ms"))
            print(Formatter.success("=" * 50))

    # 显示约束操作结果
    if constraint_results:
        if all(r.get("success") for r in constraint_results):
            print(Formatter.success("\n" + "=" * 50))
            print(Formatter.success("✓ 约束操作成功"))
            print(Formatter.success("=" * 50))

            for r in constraint_results:
                msg = r.get("message", "N/A")
                action = r.get("action", {})
                spec = action.get("constraintSpec", {})
                is_inline = spec.get("isInline", False)
                constraint_type = spec.get("type", "N/A")
                table_name = spec.get("tableName", "未知表")
                column_name = spec.get("targetColumn", "N/A")
                params = spec.get("params", {})

                print("\n  约束配置详情:")
                print(f"    - 类型: {constraint_type}")
                print(f"    - 目标表: {table_name}")
                print(f"    - 目标列: {column_name}")

                if params:
                    print(f"    - 参数: {params}")

                if is_inline:
                    print("    - 存储方式: 内联约束（存储在表配置中）")
                else:
                    constraint_id = msg.replace("inline:", "") if msg.startswith("inline:") else msg
                    print("    - 存储方式: 独立约束文件")
                    print(f"    - 文件路径: constraints/{constraint_id}.constraint.yaml")

            print("\n" + "=" * 50)
        else:
            print(Formatter.error("\n" + "=" * 50))
            print(Formatter.error("✗ 约束操作失败"))
            print(Formatter.error("=" * 50))
            for r in constraint_results:
                if not r.get("success"):
                    msg = r.get("message", "未知错误")
                    print(f"  - 错误: {msg}")
            print("=" * 50)
