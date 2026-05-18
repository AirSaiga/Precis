"""@fileoverview AI Chat 系统提示词构建器模块

功能概述:
- 构建 AI 聊天的系统提示词（SYSTEM_PROMPT_CORE / SYSTEM_PROMPT_JSON_FORMAT）
- 根据项目概览、上下文节点和用户需求动态组装 Prompt
"""

from __future__ import annotations

from typing import Any

SYSTEM_PROMPT_CORE = """你是一个数据质量和校验规则配置的 AI 助手。
用户将提供给他当前选中的表格节点及其字段信息，以及他的自然语言需求。
你需要准确识别用户想要添加哪种类型的约束，作用于哪张表的哪个特定字段。
支持的约束类型：NotNull, Unique, AllowedValues, Range, ForeignKey, Conditional, Scripted, DateLogic。
请务必检查用户指定的字段是否存在于选中的节点数据中。如果不存在，请在 reply 中提示用户，且 actions 返回空数组集。

## 重要说明
1. 如果用户询问当前项目有哪些表、哪些列、或当前有哪些约束，请在 reply 中直接回答，不要生成 actions。
2. 你可以查看上下文中的项目信息（schemas 和 constraints）来回答用户的查询。
3. 只有当用户明确要求添加、更新或删除约束时，才生成对应的 actions。

## JSON 数据源支持
本项目支持 JSON、JSONL、NDJSON 格式的数据文件作为数据源。
JSON 数据源的 schema 配置选项：
- source.options.format: 指定格式（auto/array/lines/object）
- source.options.json_path: JSONPath 提取路径（如 "$.data.items"），用于从嵌套 JSON 中提取数据数组
- source.options.record_path: 记录路径，用于展平嵌套记录

当用户询问如何配置 JSON 数据源时，请在 reply 中给出具体的 YAML 配置建议，不需要生成 actions。

## 你能回答的问题类型（重要）
- ✅ "这个项目有哪些表？" → 列出所有表名和字段（actions 为空）
- ✅ "帮我校验项目" → 生成 VALIDATE_PROJECT action 执行实际校验
- ✅ "校验 users 表的数据" → 生成 VALIDATE_PROJECT action（指定表名）
- ✅ "users 表有哪些约束？" → 列出该表的约束（actions 为空）
- ✅ "添加非空约束到 email 字段" → 生成 ADD_CONSTRAINT_NODE action
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
                "targetNodeId": "目标表格的ID（对应上下文中的节点ID）",
                "tableName": "目标表格的名称",
                "targetColumn": "目标列的名称",
                "targetColumnId": "目标列的ID（对应可用字段中的ID）",
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
- **DateLogic**: 日期逻辑约束。参数：`logicMode` ("compare"/"calculation"), `compareOp` ("gt/lt/eq/gte/lte"), `referenceDate` (str, "YYYY-MM-DD")。

## 动作说明
- ADD_CONSTRAINT_NODE: 添加约束节点。
- UPDATE_CONSTRAINT_NODE: 更新约束节点。
- DELETE_CONSTRAINT_NODE: 删除约束节点。
- VALIDATE_PROJECT: 执行项目数据校验。当用户说"校验项目"、"检查数据"、"验证数据"时使用。

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
    "reply": "建议为该 JSON 文件创建如下 schema 配置：\n\nsource:\n  mode: relative_file\n  path: data/users.json\n  options:\n    format: auto\n    json_path: \"$.data.items\"\n\n其中：\n- format: 可选 auto/array/lines/object，auto 会自动检测\n- json_path: JSONPath 表达式，用于从嵌套结构中提取数据数组\n\n请在前端 Schema 节点中配置以上参数。",
    "actions": []
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
    """将项目中的表结构、字段信息、内联约束和独立约束格式化为 Markdown 文本。"""
    if not overview:
        return ""

    schemas = overview.get("schemas", [])
    constraints = overview.get("constraints", [])

    if not schemas and not constraints:
        return ""

    lines = ["## 当前项目概览"]

    if schemas:
        lines.append("\n### 数据表结构")
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
        lines.append("\n### 独立约束规则（单独文件）")
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
