"""
@fileoverview AI 服务通用工具函数

功能概述:
- 估算文本 Token 数量（支持中英文混合）
- 按 Token 上限截断聊天历史记录
- 扫描项目目录生成项目概览（Schema / Constraint 列表）

架构设计:
- 纯函数设计，无副作用，便于单元测试
- Token 估算采用字符分类加权策略：中文单字 + 英文单词 + 数字 + 标点
- 项目概览扫描递归读取 schemas/ 和 constraints/ 目录下的 YAML 文件

输入示例:
    estimate_tokens("Hello 世界")
    truncate_history_by_tokens(history, "系统提示", max_tokens=120000)
    get_project_overview("/path/to/project")

输出示例:
    7  # Token 估算值
    [{"role": "user", "content": "..."}]  # 截断后的历史
    {"schemas": [...], "constraints": [...]}  # 项目概览
"""

import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def estimate_tokens(text: str) -> int:
    """
    @methoddesc 估算文本的 Token 数量

    采用简单的字符分类加权策略，适合快速估算：
    - 中文字符：每个字算 1 个 Token
    - 英文单词：每个单词算 1 个 Token
    - 数字串：每组连续数字算 1 个 Token
    - 标点符号：每个算 1 个 Token
    最后加上 10 个 Token 的固定开销（用于角色标记等）。

    参数:
        text: 要估算的文本字符串

    返回:
        估算的 Token 数量（整数）
    """
    if not text:
        return 0

    # 按字符类型分别统计数量
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", text))  # 中文字符
    english_words = len(re.findall(r"[a-zA-Z]+", text))  # 英文单词
    numbers = len(re.findall(r"\d+", text))  # 数字串
    punctuations = len(re.findall(r"[^\w\s]", text))  # 标点符号

    total = chinese_chars + english_words + numbers + punctuations
    # 加上固定开销（系统提示、消息格式等消耗的额外 Token）
    return total + 10


def truncate_history_by_tokens(
    chat_history: list[dict[str, str]],
    system_prompt: str,
    max_tokens: int = 120000,
) -> list[dict[str, str]]:
    """
    @methoddesc 按 Token 上限截断聊天历史记录

    从最近的消息开始往前累加，直到接近 max_tokens 上限为止。
    至少保留最近 2 条消息（确保对话连贯性）。

    参数:
        chat_history: 历史消息列表，每条消息格式为 {"role": "user", "content": "..."}
        system_prompt: 系统提示词文本（用于计算初始 Token 占用）
        max_tokens: 允许的最大 Token 数量，默认 120000

    返回:
        截断后的历史消息列表
    """
    if not chat_history:
        return []

    # 计算系统提示词占用的 Token 数
    system_tokens = estimate_tokens(system_prompt)

    # 为每条历史消息估算 Token 数
    history_with_tokens = []
    for msg in chat_history:
        tokens = estimate_tokens(msg.get("content", ""))
        history_with_tokens.append((msg, tokens))

    total_tokens = system_tokens
    keep_count = 0

    # 从最新的消息往前累加，直到超出上限
    for msg, tokens in reversed(history_with_tokens):
        if total_tokens + tokens > max_tokens:
            break
        total_tokens += tokens
        keep_count += 1

    # 至少保留最近 2 条消息（一问一答），避免截断后完全失去上下文
    keep_count = max(keep_count, min(2, len(chat_history)))

    truncated = chat_history[-keep_count:] if keep_count < len(chat_history) else chat_history

    if len(truncated) < len(chat_history):
        removed = len(chat_history) - len(truncated)
        logger.info(
            f"[truncate_history] 截断 {removed} 条历史，保留 {len(truncated)} 条，"
            f"估算 Token: {total_tokens}/{max_tokens}"
        )

    return truncated


def get_project_overview(project_path: str) -> dict[str, Any]:
    """
    @methoddesc 扫描项目目录，生成项目概览信息

    读取项目下的 schemas/ 和 constraints/ 目录中的 YAML 文件，
    汇总所有表结构、字段信息以及约束规则，供 AI 上下文使用。

    参数:
        project_path: 项目根目录路径

    返回:
        项目概览字典，包含 schemas 和 constraints 两个列表
    """
    overview: dict[str, Any] = {"schemas": [], "constraints": [], "transforms": [], "regex_nodes": [], "settings": {}}

    if not project_path:
        return overview

    project_path = Path(project_path)

    schemas_dir = project_path / "schemas"
    if schemas_dir.exists():
        for schema_file in schemas_dir.glob("*.yaml"):
            try:
                import yaml

                with open(schema_file, encoding="utf-8") as f:
                    schema_data = yaml.safe_load(f) or {}

                table_name = schema_data.get("name", "")
                table_id = schema_data.get("id", table_name)
                columns = schema_data.get("columns", [])
                inline_constraints = schema_data.get("constraints", [])

                column_list = []
                column_map = {}
                for c in columns:
                    col_name = c.get("name", "")
                    col_id = c.get("id", col_name)
                    col_type = c.get("type", "")
                    column_list.append({"id": col_id, "name": col_name, "type": col_type})
                    column_map[col_id] = col_name

                if table_name or table_id:
                    overview["schemas"].append({"id": table_id, "name": table_name, "columns": column_list})

                for ic in inline_constraints:
                    col_id = ic.get("column", "")
                    col_name = column_map.get(col_id, col_id)
                    constraint_type = ic.get("type", "")
                    params = ic.get("params", {})

                    overview["constraints"].append(
                        {
                            "id": ic.get("id", ""),
                            "type": constraint_type,
                            "description": f"{table_name}.{col_name} - {constraint_type} 约束 (内联)",
                            "enabled": True,
                            "table_id": table_id,
                            "table_name": table_name,
                            "column_id": col_id,
                            "column_name": col_name,
                            "params": params,
                            "is_inline": True,
                        }
                    )
            except Exception as e:
                logger.debug(f"读取 schema 文件失败 {schema_file}: {e}")

    constraints_dir = project_path / "constraints"
    if constraints_dir.exists():
        for constraint_file in constraints_dir.glob("*.constraint.yaml"):
            try:
                import yaml

                with open(constraint_file, encoding="utf-8") as f:
                    constraint_data = yaml.safe_load(f) or {}

                constraint_id = constraint_data.get("id", "")
                constraint_type = constraint_data.get("type", "")
                description = constraint_data.get("description", "")
                enabled = constraint_data.get("enabled", True)
                refs = constraint_data.get("refs", {})
                params = constraint_data.get("params", {})

                table_id = refs.get("table_id", "")
                column_id = refs.get("column_id", "")
                column_ids = refs.get("column_ids", [])

                overview["constraints"].append(
                    {
                        "id": constraint_id,
                        "type": constraint_type,
                        "description": description,
                        "enabled": enabled,
                        "table_id": table_id,
                        "column_id": column_id,
                        "column_ids": column_ids,
                        "params": params,
                        "is_inline": False,
                    }
                )
            except Exception as e:
                logger.warning(f"读取 constraint 文件失败 {constraint_file}: {e}")

    # 扫描 Regex 节点
    for dirname in ("regex_nodes", "regex"):
        regex_dir = project_path / dirname
        if regex_dir.exists():
            for regex_file in regex_dir.glob("*.yaml"):
                try:
                    import yaml

                    with open(regex_file, encoding="utf-8") as f:
                        regex_data = yaml.safe_load(f) or {}

                    overview["regex_nodes"].append(
                        {
                            "id": regex_data.get("id", ""),
                            "name": regex_data.get("name", ""),
                            "pattern": regex_data.get("pattern", ""),
                            "match_mode": regex_data.get("match_mode", "full"),
                            "enabled": regex_data.get("enabled", True),
                            "source_ref": regex_data.get("source_ref"),
                        }
                    )
                except Exception as e:
                    logger.debug(f"读取 regex 文件失败 {regex_file}: {e}")

    # 扫描 Transform 节点
    transforms_dir = project_path / "transforms"
    if transforms_dir.exists():
        for transform_file in transforms_dir.glob("*.yaml"):
            try:
                import yaml

                with open(transform_file, encoding="utf-8") as f:
                    transform_data = yaml.safe_load(f) or {}

                overview["transforms"].append(
                    {
                        "id": transform_data.get("id", ""),
                        "type": transform_data.get("type", ""),
                        "enabled": transform_data.get("enabled", True),
                        "input_from_node": transform_data.get("input_from_node"),
                        "input_column": transform_data.get("input_column"),
                        "output_columns": transform_data.get("output_columns", []),
                    }
                )
            except Exception as e:
                logger.debug(f"读取 transform 文件失败 {transform_file}: {e}")

    # 读取项目设置
    manifest_path = project_path / "project.precis.yaml"
    if manifest_path.exists():
        try:
            import yaml

            with open(manifest_path, encoding="utf-8") as f:
                manifest_data = yaml.safe_load(f) or {}

            overview["settings"] = manifest_data.get("settings", {})
        except Exception as e:
            logger.debug(f"读取 manifest 设置失败 {manifest_path}: {e}")

    return overview
