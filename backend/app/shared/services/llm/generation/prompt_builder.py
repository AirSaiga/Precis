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
    提示词包含数据画像、Schema 格式说明、Constraint 格式说明和 Regex Node 格式说明。

    参数:
        profiling_data: 数据画像结果列表
        project_name: 项目名称

    返回:
        完整的 LLM 提示词字符串
    """
    prompt = f"""请为项目 "{project_name}" 生成 Precis 数据验证配置。

## 数据画像

"""
    for item in profiling_data:
        table_name = item.get("table_name", "")
        prompt += f"### 表: {table_name}\n"
        prompt += f"- 文件: {item.get('path', '')}\n"
        if item.get("sheet_name"):
            prompt += f"- Sheet: {item['sheet_name']}\n"
        prompt += "- 列:\n"

        for col in item.get("columns", []):
            prompt += f"  - {col['name']} (类型: {col['dtype']}, 空值: {col['null_count']})\n"
            if col.get("sample_values"):
                prompt += f"    样本: {col['sample_values'][:3]}\n"

    prompt += """
## 输出要求

请返回 JSON 格式的配置，包含以下字段:
- schemas: 表结构定义列表
- constraints: 约束规则列表
- regex_nodes: 正则节点列表（可选）

### Schema 格式
每个 schema 必须包含 id、name、columns，以及 source（数据源配置）：
```json
{
  "id": "users",
  "name": "users",
  "source": {
    "mode": "relative_file",
    "path": "data/users.xlsx",
    "sheet": "Sheet1",
    "header_row": 0
  },
  "columns": [
    {"id": "user_id", "name": "user_id", "type": "string", "primary_key": true, "nullable": false},
    {"id": "email", "name": "email", "type": "string", "nullable": true}
  ]
}
```
注意：source.path 请使用相对于项目根目录的路径，如 "data/xxx.xlsx"。

### Constraint 格式（V2 标准）
约束必须使用 refs/params 分离结构：
```json
{
  "id": "users_email_notnull",
  "type": "NotNull",
  "enabled": true,
  "description": "邮箱不能为空",
  "refs": {
    "table_id": "users",
    "column_id": "email"
  },
  "params": {}
}
```

支持约束类型及对应 refs/params：
- **NotNull**: refs `{table_id, column_id}`, params `{}`
- **Unique**: refs `{table_id, column_ids: [col1]}`, params `{}`
- **AllowedValues**: refs `{table_id, column_id}`, params `{allowed_values: ["男", "女"]}`
- **Range**: refs `{table_id, column_id}`, params `{min: 0, max: 100}`
- **ForeignKey**: refs `{from_table_id, from_column_id, to_table_id, to_column_id}`, params `{}`
- **Conditional**: refs `{table_id, then_column_id, if_conditions: [{if_column_id, operator, value}], if_logic: "and"}`, params `{then_value: "..."}`

约束 id 建议语义化，如 `{table_id}_{column_id}_{type}`，例如 `users_email_notnull`。

### Regex Node 格式
```json
{
  "id": "users_email_regex",
  "name": "邮箱格式校验",
  "description": "校验邮箱格式",
  "pattern": "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
  "match_mode": "full",
  "case_sensitive": false,
  "enabled": true,
  "source_ref": {
    "table_id": "users",
    "column_id": "email"
  }
}
```

### 建议
- 对 email/手机号/身份证号等常见字段生成对应的 regex_nodes
- 对 status/gender 等枚举字段生成 AllowedValues 约束
- 对主键列生成 Unique 约束
- 对非空列生成 NotNull 约束
- 对数值范围有意义的列生成 Range 约束

请直接返回纯 JSON，不要包含任何解释文字。
"""
    return prompt
