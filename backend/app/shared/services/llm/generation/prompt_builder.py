"""@fileoverview Prompt 构建器

功能概述:
- 根据数据画像结果构建 LLM 提示词
- 包含 Schema、Constraint、Regex Node 的格式说明

输入示例:
    profiling_data = [{"table_name": "users", "columns": [...]}]
    prompt = build_prompt(profiling_data, "电商数据校验")

输出示例:
    完整的 LLM 提示词字符串
"""


def build_prompt(profiling_data: list[dict], project_name: str) -> str:
    """
    @methoddesc 构建生成提示词

    根据数据画像结果和项目名称，构建用于请求 LLM 生成配置的完整提示词。
    针对本地小模型的优化：限制列数、样本值数量和长度。

    参数:
        profiling_data: 数据画像结果列表
        project_name: 项目名称

    返回:
        完整的 LLM 提示词字符串
    """
    max_columns_per_table = 20
    max_sample_values = 2
    max_sample_length = 30

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

Schema 格式：
{"id": "users", "name": "users", "source": {"mode": "relative_file", "path": "data/users.xlsx", "header_row": 0}, "columns": [{"id": "col_id", "name": "col_name", "type": "string", "primary_key": true, "nullable": false}]}

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
    return prompt
