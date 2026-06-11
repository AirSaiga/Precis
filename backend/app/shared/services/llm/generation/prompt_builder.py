"""@fileoverview Prompt 构建器

功能概述:
- 根据数据画像结果构建 LLM 提示词
- 包含 Schema、Constraint、Regex Node 的格式说明
- 支持 prompt 长度预算：超限后自动降级（减少列数 → 减少文件数）

输入示例:
    profiling_data = [{"table_name": "users", "columns": [...]}]
    prompt, warnings = build_prompt(profiling_data, "电商数据校验")

输出示例:
    (prompt_string, ["部分文件因 prompt 过长被省略: ..."])
"""

import logging

logger = logging.getLogger(__name__)

# 默认 prompt 长度预算（字符数）。DeepSeek v4-flash 支持 1M 上下文，
# 但给 system prompt、输出和 overhead 留余量，预算设为 80K 字符。
DEFAULT_MAX_PROMPT_CHARS = 80_000


def _estimate_prompt_len(
    profiling_data: list[dict],
    project_name: str,
    max_columns_per_table: int,
    max_sample_values: int,
    max_sample_length: int,
) -> int:
    """估算 prompt 长度（不实际构建完整字符串）"""
    length = len(project_name) + 200  # 固定开销（header、格式说明等）
    for item in profiling_data:
        length += 100  # 表头开销
        length += len(item.get("table_name", ""))
        length += len(item.get("path", ""))
        if item.get("sheet_name"):
            length += 50
        columns = item.get("columns", [])[:max_columns_per_table]
        for col in columns:
            length += 80 + len(col["name"]) + len(str(col["dtype"]))
            samples = col.get("sample_values", [])[:max_sample_values]
            length += sum(min(len(str(s)), max_sample_length) for s in samples)
        remaining = len(item.get("columns", [])) - max_columns_per_table
        if remaining > 0:
            length += 40
    return length


def build_prompt(
    profiling_data: list[dict],
    project_name: str,
    max_prompt_chars: int = DEFAULT_MAX_PROMPT_CHARS,
) -> tuple[str, list[str]]:
    """
    @methoddesc 构建生成提示词（带长度预算和自动降级）

    策略（渐进式降级）：
    1. 先用较宽松的列数限制（20 列/表，2 样本值）估算长度
    2. 若超限，先降低列数限制（20 → 10 → 5）
    3. 若仍超限，减少文件数（保留前 N 个）
    4. 最终返回 truncation 警告列表

    参数:
        profiling_data: 数据画像结果列表
        project_name: 项目名称
        max_prompt_chars: prompt 最大字符数预算

    返回:
        (prompt 字符串, truncation 警告列表)
    """
    max_columns_per_table = 20
    max_sample_values = 2
    max_sample_length = 30
    warnings: list[str] = []

    # 阶段 1: 估算长度，尝试逐步降级
    # 降级策略：列数限制 [20, 10, 5, 3]，然后截断文件数
    for columns_limit in (20, 10, 5, 3):
        max_columns_per_table = columns_limit
        estimated = _estimate_prompt_len(
            profiling_data, project_name, max_columns_per_table, max_sample_values, max_sample_length
        )
        if estimated <= max_prompt_chars:
            if columns_limit < 20:
                warnings.append(f"数据文件较多，prompt 长度受限，每表仅展示前 {columns_limit} 列")
            break
    else:
        # 即使 3 列也超限，需要截断文件数
        # 二分查找最大可处理的文件数
        lo, hi = 1, len(profiling_data)
        best_files = 1
        while lo <= hi:
            mid = (lo + hi) // 2
            estimated = _estimate_prompt_len(
                profiling_data[:mid], project_name, 3, max_sample_values, max_sample_length
            )
            if estimated <= max_prompt_chars:
                best_files = mid
                lo = mid + 1
            else:
                hi = mid - 1

        profiling_data = profiling_data[:best_files]
        omitted = len(profiling_data) - best_files if len(profiling_data) > best_files else 0
        if omitted > 0:
            warnings.append(f"数据文件过多（共 {len(profiling_data) + omitted} 个），仅分析前 {best_files} 个文件")
        max_columns_per_table = 3

    # 阶段 2: 实际构建 prompt
    prompt = f"""为项目 "{project_name}" 生成数据验证配置。

## 数据画像

"""
    for item in profiling_data:
        table_name = item.get("table_name", "")
        prompt += f"### {table_name}\n"
        prompt += f"文件: {item.get('path', '')}\n"
        if item.get("sheet_name"):
            prompt += f"Sheet: {item['sheet_name']}\n"

        columns = item.get("columns", [])[:max_columns_per_table]
        for col in columns:
            samples = col.get("sample_values", [])[:max_sample_values]
            samples_str = ", ".join(str(s)[:max_sample_length] for s in samples)
            prompt += f"- {col['name']}: {col['dtype']}, 空值{col['null_count']}"
            if samples_str:
                prompt += f", 例: {samples_str}"
            prompt += "\n"

        remaining = len(item.get("columns", [])) - max_columns_per_table
        if remaining > 0:
            prompt += f"- ... 还有 {remaining} 列未显示\n"

    prompt += """
## 输出要求

返回 JSON 配置，包含 schemas、constraints、regex_nodes 三个字段。

Schema 格式（id 由服务端根据 path + sheet 自动生成，无需填写）：
{"name": "users", "source": {"mode": "relative_file", "path": "data/users.xlsx", "header_row": 0}, "columns": [{"id": "col_id", "name": "col_name", "type": "string", "primary_key": true, "nullable": false}]}

Constraint 格式（V2，refs/params 分离）：
{"id": "users_email_notnull", "type": "NotNull", "enabled": true, "refs": {"table_id": "users", "column_id": "email"}, "params": {}}

支持类型：NotNull, Unique, AllowedValues(refs+params{allowed_values}), Range(refs+params{min,max}), ForeignKey, Conditional。

Regex Node 格式：
{"id": "email_regex", "name": "邮箱格式", "pattern": "^[^@]+@[^@]+$", "match_mode": "full", "source_ref": {"table_id": "users", "column_id": "email"}}

建议：
- email/手机号/身份证 → regex_nodes
- status/gender → AllowedValues
- 主键 → Unique
- 非空列 → NotNull
- 数值列 → Range

直接返回 JSON，不要解释。"""

    actual_len = len(prompt)
    logger.info(
        "[build_prompt] files=%d, columns_limit=%d, estimated=%d, actual=%d",
        len(profiling_data),
        max_columns_per_table,
        _estimate_prompt_len(profiling_data, project_name, max_columns_per_table, max_sample_values, max_sample_length),
        actual_len,
    )

    return prompt, warnings
