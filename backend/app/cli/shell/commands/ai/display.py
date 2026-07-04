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


# 工具名到中文标签的映射（与 ChatAgentRunner._TOOL_LABELS 保持一致）
_TOOL_LABELS = {
    "read_project": "读取项目",
    "read_table": "查看数据",
    "apply_actions": "修改配置",
    "validate_table": "校验数据",
    "read_canvas": "读取画布",
}


def _display_tool_trail(tool_steps: list[dict]) -> None:
    """显示 Agent 工具调用轨迹。

    在 CLI 交互模式下，当 AI 使用 Agent 工具循环完成查-改-验后，
    输出简要的工具步骤摘要，让用户感知 AI 的思考与操作路径。

    Args:
        tool_steps: ChatAgentRunResult.tool_steps 列表，每个元素含 tool/label/turn/action_count/status
    """
    if not tool_steps:
        return

    print(Formatter.header("\n🔧 Agent 工具轨迹"))
    for step in tool_steps:
        label = step.get("label") or _TOOL_LABELS.get(step.get("tool", ""), step.get("tool", "未知"))
        action_count = step.get("action_count")
        status = step.get("status", "success")
        error = step.get("error")

        count_str = f"({action_count})" if action_count else ""
        status_marker = "✓" if status == "success" else "✗" if status == "failed" else "•"
        line = f"  {status_marker} {label}{count_str}"
        if error:
            line += f" — {error}"
        print(Formatter.info(line))


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


def _display_execution_results(
    result,
    project_path: str,
    original_files_cache: dict[str, str] | None = None,
) -> None:
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

    # 判断是否有会修改文件的操作
    file_modification_types = {
        "ADD_CONSTRAINT_NODE",
        "UPDATE_CONSTRAINT_NODE",
        "DELETE_CONSTRAINT_NODE",
        "ADD_SCHEMA",
        "UPDATE_SCHEMA",
        "DELETE_SCHEMA",
        "ADD_REGEX",
        "UPDATE_REGEX",
        "DELETE_REGEX",
        "ADD_TRANSFORM",
        "UPDATE_TRANSFORM",
        "DELETE_TRANSFORM",
        "UPDATE_SETTINGS",
    }
    has_modifications = any(a.get("actionType") in file_modification_types for a in actions)

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


def _format_validate_table_display(table_filter: str | list[str] | None) -> str:
    """根据校验的 table_filter 推导出用于展示的"表"描述文案。

    校验结果详情（validate_details）里的 table_filter 才是真实信息源：
    - None/空 → 全量校验
    - 字符串 → 单表校验
    - 列表 → 多表校验

    Args:
        table_filter: validate_executor 返回的 details.table_filter 值

    Returns:
        适合直接拼接进 "✓ 表 '...' 数据校验通过" 的描述文案
    """
    # 全量校验（None 或空字符串/空列表）
    if not table_filter:
        return "全部表"
    # 单表（字符串）
    if isinstance(table_filter, str):
        return table_filter
    # 列表形式
    tables = [t for t in table_filter if t]
    if not tables:
        return "全部表"
    if len(tables) == 1:
        return tables[0]
    return f"{len(tables)} 张表（{', '.join(tables)}）"


def _display_constraint_results(results: list[dict]) -> None:
    """显示操作结果。

    将动作结果分为四类：
    1. VALIDATE_PROJECT：数据校验结果
    2. 约束操作：约束 CRUD 结果
    3. Schema/Regex/Transform/Settings 操作
    4. 其他操作

    Args:
        results: 动作执行结果列表，每个元素是一个字典
    """
    constraint_types = {"ADD_CONSTRAINT_NODE", "UPDATE_CONSTRAINT_NODE", "DELETE_CONSTRAINT_NODE"}
    schema_types = {"ADD_SCHEMA", "UPDATE_SCHEMA", "DELETE_SCHEMA"}
    regex_types = {"ADD_REGEX", "UPDATE_REGEX", "DELETE_REGEX"}
    transform_types = {"ADD_TRANSFORM", "UPDATE_TRANSFORM", "DELETE_TRANSFORM"}

    # 分离各类结果
    validate_results = [r for r in results if r.get("action", {}).get("actionType") == "VALIDATE_PROJECT"]
    constraint_results = [r for r in results if r.get("action", {}).get("actionType") in constraint_types]
    schema_results = [r for r in results if r.get("action", {}).get("actionType") in schema_types]
    regex_results = [r for r in results if r.get("action", {}).get("actionType") in regex_types]
    transform_results = [r for r in results if r.get("action", {}).get("actionType") in transform_types]
    settings_results = [r for r in results if r.get("action", {}).get("actionType") == "UPDATE_SETTINGS"]

    # 显示校验结果
    for r in validate_results:
        msg = r.get("message", "")
        details = r.get("validate_details", {})
        has_errors = details.get("has_errors", False) if details else False
        # 展示文案优先取 action.constraintSpec 里的"原始表名"（用户友好）：
        # - 多表：spec.tables（表名列表）
        # - 单表：spec.tableName（表名，resolver 解析后仍保留原名）
        # - 全量：两者都没有 → fallback 到 validate_details.table_filter（None）
        # 注意：validate_details.table_filter 在 resolver 解析后会变成"表 ID"（加密串），
        # 直接展示对用户不友好，故仅作兜底。
        spec = r.get("action", {}).get("constraintSpec", {}) or {}
        raw_tables = spec.get("tables")
        if isinstance(raw_tables, list) and raw_tables:
            table_display = _format_validate_table_display(raw_tables)
        else:
            single_name = spec.get("tableName")
            fallback = single_name or (details.get("table_filter") if details else None)
            table_display = _format_validate_table_display(fallback)

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

    # 显示 Schema 操作结果
    if schema_results:
        print(Formatter.header("\n📋 Schema 操作"))
        for r in schema_results:
            action_type = r.get("action", {}).get("actionType", "")
            spec = r.get("action", {}).get("schemaSpec", {})
            name = spec.get("name", spec.get("schemaId", "未知"))
            if r.get("success"):
                print(Formatter.success(f"  ✓ {action_type}: {name}"))
            else:
                print(Formatter.error(f"  ✗ {action_type}: {name} - {r.get('message', '')}"))

    # 显示 Regex 操作结果
    if regex_results:
        print(Formatter.header("\n🔤 Regex 操作"))
        for r in regex_results:
            action_type = r.get("action", {}).get("actionType", "")
            spec = r.get("action", {}).get("regexSpec", {})
            name = spec.get("name", spec.get("regexId", "未知"))
            if r.get("success"):
                print(Formatter.success(f"  ✓ {action_type}: {name}"))
            else:
                print(Formatter.error(f"  ✗ {action_type}: {name} - {r.get('message', '')}"))

    # 显示 Transform 操作结果
    if transform_results:
        print(Formatter.header("\n⚙ Transform 操作"))
        for r in transform_results:
            action_type = r.get("action", {}).get("actionType", "")
            spec = r.get("action", {}).get("transformSpec", {})
            t_type = spec.get("type", spec.get("transformId", "未知"))
            if r.get("success"):
                print(Formatter.success(f"  ✓ {action_type}: {t_type}"))
            else:
                print(Formatter.error(f"  ✗ {action_type}: {t_type} - {r.get('message', '')}"))

    # 显示 Settings 操作结果
    if settings_results:
        print(Formatter.header("\n⚙ 项目设置"))
        for r in settings_results:
            spec = r.get("action", {}).get("settingsSpec", {})
            category = spec.get("category", "未知")
            if r.get("success"):
                print(Formatter.success(f"  ✓ 更新设置: {category}"))
            else:
                print(Formatter.error(f"  ✗ 更新设置失败: {r.get('message', '')}"))
