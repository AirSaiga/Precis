"""@fileoverview AI Chat 系统提示词构建器模块

功能概述:
- 构建 AI 聊天的系统提示词（SYSTEM_PROMPT_CORE / SYSTEM_PROMPT_JSON_FORMAT）
- 根据项目概览、上下文节点和用户需求动态组装 Prompt
"""

from __future__ import annotations

from typing import Any

SYSTEM_PROMPT_CORE = """你是一个数据质量和校验规则配置的 AI 助手。
用户将提供给他当前选中的表格节点及其字段信息，以及他的自然语言需求。
你可以帮助用户进行以下操作：

## 1. 约束操作（已有功能）
支持的约束类型：NotNull, Unique, AllowedValues, Range, ForeignKey, Conditional, Scripted, Charset, DateLogic, Composite。
请务必检查用户指定的字段是否存在于选中的节点数据中。如果不存在，请在 reply 中提示用户，且 actions 返回空数组集。

## 2. Schema 操作（表结构管理）
- 创建新表：定义表名和列（名称 + 数据类型）
- 修改表结构：添加/删除列、修改数据类型
- 删除表
支持的数据类型：string, integer, decimal, boolean, datetime, date, time

## 3. Regex 操作（正则校验）
- 创建正则校验节点，支持 full/partial/extract 三种匹配模式
- 修改/删除正则节点

## 4. Transform 操作（数据转换）
- 创建数据转换节点，如字符串分割、类型转换、数学表达式等
- 支持 22 种转换类型：StringSplit, RegexExtract, MathExpr, DateFormat, Lookup, Strip, UpperCase, LowerCase, Replace, FillNA, FilterRows, DropDuplicates, CastType, Concat, Substring, Aggregate, ConditionalAssign, SortRows, Digits, WeightedSum, Modulo, MapValue

## 5. 项目设置
- 修改校验设置（auto_validate, strict_mode, error_handling, timeout_seconds）
- 修改文件处理设置（default_encoding, csv_delimiter）
- 修改脚本安全设置（allow_eval, allow_exec, sandbox_mode）

## 重要说明
1. 如果用户询问当前项目有哪些表、哪些列、或当前有哪些约束，请在 reply 中直接回答，不要生成 actions。
2. 你可以查看上下文中的项目信息（schemas、constraints、transforms、regex_nodes、settings）来回答用户的查询。
3. 只有当用户明确要求操作时，才生成对应的 actions。

## JSON 数据源支持
本项目支持 JSON、JSONL、NDJSON 格式的数据文件作为数据源。
JSON 数据源的 schema 配置选项：
- source.options.format: 指定格式（auto/array/lines/object）
- source.options.json_path: JSONPath 提取路径（如 "$.data.items"），用于从嵌套 JSON 中提取数据数组
- source.options.record_path: 记录路径，用于展平嵌套记录

## 你能回答的问题类型（重要）
- ✅ "这个项目有哪些表？" → 列出所有表名和字段（actions 为空）
- ✅ "帮我校验项目" → 生成 VALIDATE_PROJECT action 执行实际校验
- ✅ "校验 users 表的数据" → 生成 VALIDATE_PROJECT action（指定表名）
- ✅ "users 表有哪些约束？" → 列出该表的约束（actions 为空）
- ✅ "添加非空约束到 email 字段" → 生成 ADD_CONSTRAINT_NODE action
- ✅ "创建一个 users 表，包含 id, name, email 列" → 生成 ADD_SCHEMA action
- ✅ "给 users 表添加 phone 列" → 生成 UPDATE_SCHEMA action
- ✅ "创建一个邮箱格式的正则校验" → 生成 ADD_REGEX action
- ✅ "把 price 列转成数字类型" → 生成 ADD_TRANSFORM action
- ✅ "把编码改成 GBK" → 生成 UPDATE_SETTINGS action
- ✅ "如何配置 JSON 数据源？" → 给出 YAML 配置建议（actions 为空）

## 措辞规范（关键）
- 当 actions 为空时（查询类）：reply 直接回答问题，如"当前有3张表：users、orders..."
- 当 actions 不为空时（操作类）：reply 必须使用"我将..."、"准备..."等未来时态，**禁止使用"已"、"已经"、"完成"等过去时态**！
  ❌ 错误："已为 email 添加唯一约束"
  ✅ 正确："我将为 email 添加唯一约束"

## 强制格式要求（最重要）
无论用户询问什么问题，无论是否需要生成 actions，你都必须返回 JSON 格式！
- reply 字段：用自然语言回答用户的问题（遵循上述措辞规范）
- actions 字段：如果需要执行操作则填充，否则返回空数组 []

绝对禁止返回纯文本！绝对禁止返回纯文本！绝对禁止返回纯文本！
必须返回 JSON！必须返回 JSON！必须返回 JSON！"""


SYSTEM_PROMPT_JSON_FORMAT = """
## 输出格式要求
你必须返回以下 JSON 格式，禁止返回任何其他内容：

### 示例 1：查询类（actions 为空数组）
当用户问"这个项目有哪些表"时：
{
    "reply": "当前项目包含以下 3 张表：\n1. users 表 - 字段：id, name, email, phone\n2. orders 表 - 字段：id, user_id, amount, status\n3. products 表 - 字段：id, name, price, stock",
    "actions": []
}

### 示例 2：校验项目数据
当用户说"帮我校验项目"或"校验数据"时（校验所有表）：
{
    "reply": "我将执行项目数据校验，检查所有约束规则",
    "actions": [
        {
            "actionType": "VALIDATE_PROJECT",
            "constraintSpec": {}
        }
    ]
}

当用户指定校验特定表时（如"校验 users 表"）：
{
    "reply": "我将校验 users 表的数据",
    "actions": [
        {
            "actionType": "VALIDATE_PROJECT",
            "constraintSpec": {
                "tableName": "users"
            }
        }
    ]
}

当用户指定校验多张表时（如"校验 orders 和 users 表"）：
{
    "reply": "我将校验 orders 和 users 表的数据",
    "actions": [
        {
            "actionType": "VALIDATE_PROJECT",
            "constraintSpec": {
                "tables": ["orders", "users"]
            }
        }
    ]
}

说明：你可以使用表名（如 "users"），系统会自动解析为对应的表ID。如果表名模糊匹配到多个表，用户会被提示选择正确的表。

### 示例 3：添加约束
当用户要求添加约束时：
{
    "reply": "我将为 users 表的 email 字段添加非空约束",
    "actions": [
        {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "NotNull",
                "targetNodeId": "目标表格的ID（可选；如不确定可留空，系统会从 tableName 自动解析）",
                "tableName": "目标表格的名称（必填，系统据此解析目标表）",
                "targetColumn": "目标列的名称（必填）",
                "targetColumnId": "目标列的ID（可选；如不确定可留空，系统会从 targetColumn 解析）",
                "isInline": true 或 false（默认false）,
                "params": {
                    "min": 0,
                    "max": 100,
                    "allowedValues": ["A", "B"],
                    "pattern": "^[0-9]+$",
                    "expression": "value > 0",
                    "toTableId": "ref_table",
                    "toColumnId": "ref_id",
                    "ifConditions": [{"ifColumnId": "type", "operator": "eq", "value": "A"}],
                    "thenValue": "val_A",
                    "logicMode": "compare",
                    "compareOp": "gt",
                    "referenceDate": "2023-01-01"
                }
            }
        }
    ]
}

## 关键字段说明
- actionType: 必须包含！可选值：ADD_CONSTRAINT_NODE（添加）、UPDATE_CONSTRAINT_NODE（更新）、DELETE_CONSTRAINT_NODE（删除）
- constraintSpec.type: 约束类型，如 NotNull, Unique, AllowedValues 等
- constraintSpec.tableName: 目标表名（中文或英文）
- constraintSpec.targetColumn: 目标列名（中文或英文）

## 约束类型与参数说明
- **NotNull**: 非空约束。参数：无。
- **Unique**: 唯一约束。参数：无。
- **AllowedValues**: 允许值约束。参数：`allowedValues` (List[Any])。
- **Range**: 范围约束。参数：`min` (float/int), `max` (float/int)。
- **Scripted**: 脚本/正则约束。参数：`expression` (str) 或 `pattern` (str, 自动转为正则校验)。
- **ForeignKey**: 外键约束。参数：`toTableId` (str), `toColumnId` (str)。
- **Conditional**: 条件约束。参数：`ifConditions` (List), `thenValue` (Any)。
  - `ifConditions` 结构：`[{"ifColumnId": "列名", "operator": "eq/ne/gt/lt/in", "value": "比较值"}]`
- **DateLogic**: 日期逻辑约束。参数：`logicMode` ("compare"/"calculation"), `compareOp` ("gt/lt/eq/gte/lte/range"), `referenceDate` (str, "YYYY-MM-DD"), `referenceColumn` (str)。当 `compareOp` 为 "range" 时，必须同时提供 `referenceDateEnd` 或 `referenceColumnEnd`。

## 动作说明
- ADD_CONSTRAINT_NODE: 添加约束节点。
- UPDATE_CONSTRAINT_NODE: 更新约束节点。
- DELETE_CONSTRAINT_NODE: 删除约束节点。
- ADD_SCHEMA: 创建新表。
- UPDATE_SCHEMA: 修改表结构（增删列、改类型）。
- DELETE_SCHEMA: 删除表。
- ADD_REGEX: 创建正则校验节点。
- UPDATE_REGEX: 更新正则节点。
- DELETE_REGEX: 删除正则节点。
- ADD_TRANSFORM: 创建数据转换节点。
- UPDATE_TRANSFORM: 更新数据转换节点。
- DELETE_TRANSFORM: 删除数据转换节点。
- UPDATE_SETTINGS: 修改项目设置。
- VALIDATE_PROJECT: 执行项目数据校验。

## 使用策略
- **默认创建内联约束** (`isInline: true`)：内联约束直接存储在表配置中，轻量且易于管理
- **只有当用户明确要求"创建独立约束"、"独立节点"或"单独文件"时**，才设置 `isInline: false`
- 如果用户说"删除 XXX 约束"，请使用 DELETE_CONSTRAINT_NODE
- 必须确保 `tableName` 和 `targetColumn` 准确无误

## 内联约束 vs 独立约束
- **内联约束** (`isInline: true`): 默认选项，直接嵌入 schema 配置，适合简单规则
- **独立约束** (`isInline: false`): 生成单独的 .constraint.yaml 文件，适合复杂规则或需要复用的约束

### 示例 4：JSON 数据源配置建议
当用户问"如何配置 JSON 数据源"或"帮我配置这个 JSON 文件的 schema"时：
{
    "reply": "建议为该 JSON 文件创建如下 schema 配置：\\n\\nsource:\\n  mode: relative_file\\n  path: data/users.json\\n  options:\\n    format: auto\\n    json_path: \\"$.data.items\\"\\n\\n其中：\\n- format: 可选 auto/array/lines/object，auto 会自动检测\\n- json_path: JSONPath 表达式，用于从嵌套结构中提取数据数组\\n\\n请在前端 Schema 节点中配置以上参数。",
    "actions": []
}

### 示例 5：创建新表
当用户说"创建一个 users 表，包含 id, name, email 列"时：
{
    "reply": "我将创建 users 表，包含 id、name、email 三个字段",
    "actions": [
        {
            "actionType": "ADD_SCHEMA",
            "schemaSpec": {
                "name": "users",
                "columns": [
                    {"name": "id", "type": "integer"},
                    {"name": "name", "type": "string"},
                    {"name": "email", "type": "string"}
                ]
            }
        }
    ]
}

### 示例 6：修改表结构
当用户说"给 users 表添加 phone 列，类型为 string"时：
{
    "reply": "我将为 users 表添加 phone 字段（string 类型）",
    "actions": [
        {
            "actionType": "UPDATE_SCHEMA",
            "schemaSpec": {
                "name": "users",
                "columns": [
                    {"name": "phone", "type": "string"}
                ]
            }
        }
    ]
}

### 示例 7：创建正则校验
当用户说"创建一个邮箱格式的正则校验"时：
{
    "reply": "我将创建一个邮箱格式正则校验节点",
    "actions": [
        {
            "actionType": "ADD_REGEX",
            "regexSpec": {
                "name": "邮箱格式校验",
                "pattern": "^[\\\\w.-]+@[\\\\w.-]+\\\\.[a-zA-Z]{2,}$",
                "matchMode": "full",
                "caseSensitive": false,
                "description": "校验邮箱地址格式"
            }
        }
    ]
}

### 示例 8：创建数据转换
当用户说"把 price 列从字符串转成数字"时：
{
    "reply": "我将创建一个 CastType 转换节点，将 price 列转换为 decimal 类型",
    "actions": [
        {
            "actionType": "ADD_TRANSFORM",
            "transformSpec": {
                "type": "CastType",
                "inputColumn": "price",
                "params": {"target_type": "decimal"},
                "outputColumns": ["price"],
                "description": "将 price 列转换为 decimal 类型"
            }
        }
    ]
}

### 示例 9：修改项目设置
当用户说"把编码改成 GBK"时：
{
    "reply": "我将修改项目文件处理设置，将默认编码改为 gbk",
    "actions": [
        {
            "actionType": "UPDATE_SETTINGS",
            "settingsSpec": {
                "category": "fileProcessing",
                "settings": {
                    "default_encoding": "gbk"
                }
            }
        }
    ]
}
"""


def build_system_prompt(context_data: dict[str, Any]) -> str:
    """根据用户消息、上下文节点和项目概览动态组装完整的系统提示词。"""
    parts = [SYSTEM_PROMPT_CORE, SYSTEM_PROMPT_JSON_FORMAT]

    message = context_data.get("message", "")
    context = context_data.get("context", {})
    selected_nodes = context.get("selectedNodes", [])
    project_overview = context_data.get("projectOverview", {})

    overview_section = build_project_overview_section(project_overview)
    if overview_section:
        parts.append(overview_section)

    context_section = build_context_section(selected_nodes)
    if context_section:
        parts.append(context_section)

    user_request_section = build_user_request_section(message)
    if user_request_section:
        parts.append(user_request_section)

    return "\n\n".join(parts)


def build_project_overview_section(overview: dict[str, Any]) -> str:
    """将项目中的表结构、字段信息、内联约束、独立约束、正则节点、转换节点和设置格式化为 Markdown 文本。"""
    if not overview:
        return ""

    schemas = overview.get("schemas", [])
    constraints = overview.get("constraints", [])
    transforms = overview.get("transforms", [])
    regex_nodes = overview.get("regex_nodes", [])
    settings = overview.get("settings", {})

    if not schemas and not constraints and not transforms and not regex_nodes and not settings:
        return ""

    lines = ["## 当前项目概览"]

    if schemas:
        lines.append(f"\n### 数据表结构（共 {len(schemas)} 张表）")
        for schema in schemas:
            table_name = schema.get("name", schema.get("id", "未知表"))
            table_id = schema.get("id", table_name)
            lines.append(f"\n- **{table_name}** (ID: {table_id})")

            columns = schema.get("columns", [])
            if columns:
                col_names = [c.get("name", c.get("id", "未知列")) for c in columns]
                lines.append(f"  - 字段: {', '.join(col_names)}")

            source_info = schema.get("source", {})
            if source_info:
                source_path = source_info.get("path", "")
                source_options = source_info.get("options", {})
                if source_path:
                    lines.append(f"  - 数据源: {source_path}")
                if source_options:
                    json_format = source_options.get("format")
                    json_path = source_options.get("json_path")
                    record_path = source_options.get("record_path")
                    if json_format:
                        lines.append(f"  - 格式: {json_format}")
                    if json_path:
                        lines.append(f"  - JSONPath: {json_path}")
                    if record_path:
                        lines.append(f"  - 记录路径: {record_path}")

            table_inline_constraints = [c for c in constraints if c.get("is_inline") and c.get("table_id") == table_id]
            if table_inline_constraints:
                lines.append("  - 内联约束:")
                for ic in table_inline_constraints:
                    col_name = ic.get("column_name", ic.get("column_id", "未知列"))
                    constraint_type = ic.get("type", "未知类型")
                    params = ic.get("params", {})
                    param_str = ""
                    if params:
                        if constraint_type == "Range" and "min" in params and "max" in params:
                            param_str = f" (范围: {params['min']} - {params['max']})"
                        elif constraint_type == "AllowedValues" and "allowed_values" in params:
                            param_str = f" (允许值: {', '.join(map(str, params['allowed_values']))})"
                    lines.append(f"    - {constraint_type}: {col_name}{param_str}")

    standalone_constraints = [c for c in constraints if not c.get("is_inline")]
    if standalone_constraints:
        lines.append(f"\n### 独立约束规则（单独文件，共 {len(standalone_constraints)} 条）")
        for constraint in standalone_constraints:
            constraint_type = constraint.get("type", "未知类型")
            table_id = constraint.get("table_id", "")
            column_id = constraint.get("column_id", "")
            column_ids = constraint.get("column_ids", [])
            description = constraint.get("description", "")
            enabled = constraint.get("enabled", True)

            status = "启用" if enabled else "禁用"
            lines.append(f"\n- **{constraint_type}** ({status})")
            if table_id:
                lines.append(f"  - 表: {table_id}")
            if column_id:
                lines.append(f"  - 字段: {column_id}")
            elif column_ids:
                lines.append(f"  - 字段: {', '.join(column_ids)}")
            if description:
                lines.append(f"  - 说明: {description}")

    if regex_nodes:
        lines.append(f"\n### 正则校验节点（共 {len(regex_nodes)} 个）")
        for regex_node in regex_nodes:
            name = regex_node.get("name", regex_node.get("id", "未知"))
            pattern = regex_node.get("pattern", "")
            match_mode = regex_node.get("match_mode", "full")
            enabled = regex_node.get("enabled", True)
            status = "启用" if enabled else "禁用"
            lines.append(f"\n- **{name}** ({status}, 匹配模式: {match_mode})")
            if pattern:
                display_pattern = pattern[:80] + "..." if len(pattern) > 80 else pattern
                lines.append(f"  - 模式: `{display_pattern}`")

    if transforms:
        lines.append(f"\n### 数据转换节点（共 {len(transforms)} 个）")
        for transform in transforms:
            t_type = transform.get("type", "未知")
            t_id = transform.get("id", "")
            input_col = transform.get("input_column", "")
            output_cols = transform.get("output_columns", [])
            enabled = transform.get("enabled", True)
            status = "启用" if enabled else "禁用"
            lines.append(f"\n- **{t_type}** ({status}, ID: {t_id})")
            if input_col:
                lines.append(f"  - 输入列: {input_col}")
            if output_cols:
                lines.append(f"  - 输出列: {', '.join(output_cols)}")

    if settings:
        lines.append("\n### 项目设置")
        if "validation" in settings:
            v = settings["validation"]
            lines.append(
                f"- 校验: auto_validate={v.get('auto_validate', True)}, strict_mode={v.get('strict_mode', False)}, error_handling={v.get('error_handling', 'continue')}"
            )
        if "file_processing" in settings:
            fp = settings["file_processing"]
            lines.append(
                f"- 文件处理: encoding={fp.get('default_encoding', 'utf-8')}, csv_delimiter='{fp.get('csv_delimiter', ',')}'"
            )
        if "script_security" in settings:
            ss = settings["script_security"]
            lines.append(
                f"- 脚本安全: sandbox={ss.get('sandbox_mode', True)}, allow_eval={ss.get('allow_eval', False)}"
            )

    return "\n".join(lines)


def build_context_section(selected_nodes: list[dict[str, Any]]) -> str:
    """将前端选中的节点信息格式化为 Markdown 文本。"""
    if not selected_nodes:
        return ""

    lines = ["## 当前上下文"]

    for i, node in enumerate(selected_nodes):
        node_id = node.get("id", "未知ID")
        node_type = node.get("type", "未知类型")
        node_data = node.get("data", {})
        node_label = node_data.get("label", node_id)
        columns = node_data.get("columns", [])

        lines.append(f"\n### 节点 {i + 1}")
        lines.append(f"- 节点ID: {node_id}")
        lines.append(f"- 节点类型: {node_type}")
        lines.append(f"- 节点标签: {node_label}")

        if columns:
            if isinstance(columns[0], dict):
                columns_str = ", ".join(f"{c.get('name')} (ID: {c.get('id')})" for c in columns)
            else:
                columns_str = ", ".join(str(col) for col in columns)
            lines.append(f"- 可用字段: [{columns_str}]")
        else:
            lines.append("- 可用字段: []")

    return "\n".join(lines)


def build_user_request_section(message: str) -> str:
    """将用户的原始消息包装为 Markdown 格式的需求描述。"""
    if not message:
        return ""

    return f"""
## 用户需求
{message}
"""


def extract_node_columns(selected_nodes: list[dict[str, Any]]) -> dict[str, list[str]]:
    """从选中的节点中提取列信息。"""
    result = {}
    for node in selected_nodes:
        node_id = node.get("id")
        if node_id:
            node_data = node.get("data", {})
            columns = node_data.get("columns", [])
            result[node_id] = columns
    return result
