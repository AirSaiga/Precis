# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview Chat Agent Runner 模块

Chat mini-agent 的编排器。在 agent_mode=true 时，
让 Chat 路径真正跑起 plan→act→observe 工具循环。

核心职责:
- 组装 chat 专用工具（有画布客户端 9 个：read_project/list_data_files/read_table/
  infer_schema/apply_actions/validate_table/read_canvas/read_config_file/ask_user；
  无画布客户端（CLI）8 个——read_canvas 不注册）
- 构建 chat agent 系统提示词（按客户端有无画布两态构建，见 build_chat_agent_system_prompt）
- 调用 AgentExecutor 跑工具循环
- 从循环结果提取 reply + 旁路收集的 frontend_instructions
- 对外保持 ChatExecutionResult 契约不变(前端零改动)

设计要点:
- 复用 AgentExecutor/Memory/ToolRegistry 通用内核，不改动它们
- apply_actions 工具持有的 collected_instructions 列表由 runner 创建并共享，
  工具 append、runner 最终读取，实现 frontend_instructions 的旁路累积
- 当 LLM 不再调用工具、输出纯文本时，循环自然终止，该文本即为 reply
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from app.shared.services.ai.agent.chat_tools import (
    ApplyActionsTool,
    AskUserTool,
    InferSchemaTool,
    ListDataFilesTool,
    ReadCanvasTool,
    ReadConfigFileTool,
    ReadProjectTool,
    ReadTableTool,
    ValidateTableTool,
)
from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyCallbacks
from app.shared.services.ai.agent.chat_tools.ask_user import AskCallbacks

# P1-1：各工具入参的 Pydantic 校验模型，注册时按工具名查表绑定
from app.shared.services.ai.agent.chat_tools.schemas import MODEL_FOR_TOOL
from app.shared.services.ai.agent.executor import AgentExecutor
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.llm.actions.registry import (
    ACTION_COUNT,
    CANVAS_ACTION_TYPES,
    READ_ONLY_ACTION_TYPES,
    build_action_type_list_text,
    build_constraint_param_docs_text,
    build_spec_field_mapping_text,
)
from app.shared.services.llm.chat.chat_system_prompt import build_system_prompt_core
from app.shared.services.llm.config.models import DEFAULT_MAX_AGENT_ITERATIONS

logger = logging.getLogger(__name__)


def _resolve_max_agent_iterations() -> int:
    """解析 agent 工具调用预算的缺省值（单一配置回退点）。

    预算优先级：调用方显式传参 > 用户级配置 chat.max_agent_iterations > 默认常量。
    本函数只负责后两级：读取 ~/.precis/ai_providers.yaml 的 chat 段。
    配置缺失/损坏/校验失败时不能让聊天崩溃——告警并回退默认常量。

    返回:
        生效的最大迭代轮数
    """
    try:
        # 延迟导入：与 runner 内其他依赖一致，避免非 chat 场景的模块加载开销
        from app.shared.services.llm.config.loader import ConfigLoader

        return ConfigLoader().load().chat.max_agent_iterations
    except Exception as e:
        logger.warning(
            "读取 chat.max_agent_iterations 配置失败，回退默认值 %d: %s",
            DEFAULT_MAX_AGENT_ITERATIONS,
            e,
        )
        return DEFAULT_MAX_AGENT_ITERATIONS


# 只读动作类型集合（用于动态标签判断，从注册表派生）
_READ_ONLY_LABEL_TYPES = READ_ONLY_ACTION_TYPES


# =============================================================================
# 系统提示词
# =============================================================================


def _build_tool_guide(canvas_enabled: bool) -> str:
    """构建工具使用指引：定义 LLM 如何使用 chat 工具完成查-改-验闭环。

    canvas_enabled=False（无画布客户端，CLI）时：工具数 9→8，省略 read_canvas
    工具节与"画布显示类"工作流条目（后续小节/条目自动重编号），apply_actions
    指引剔除 ADD_TO_CANVAS 关键区分块。
    """
    tool_count = 9 if canvas_enabled else 8
    apply_canvas_note = (
        '- 想"把已存在的资源显示到画布上"（配置文件已有，但画布上没显示）→ 用 **ADD_TO_CANVAS**\n'
        "  （actionType=ADD_TO_CANVAS，spec 含 resourceKind: schema/regex/constraint/transform\n"
        "  和 resourceId/resourceName）。ADD_TO_CANVAS 不写盘，只把现有配置显示到画布。\n"
        if canvas_enabled
        else ""
    )
    read_canvas_section = (
        """### 7. read_canvas（查询，无参数）
读取当前**画布上实际显示**的节点列表（Schema、约束、正则、转换等），含各类数量摘要。
**与 read_project 的关键区别**：read_project 读项目配置文件，read_canvas 读画布快照——
项目配置里有的表/约束不一定已拖到画布上，两者会不一致。
**使用时机**：当用户说"画布上有没有 X"、"把 Y 放到画布/拖到画布"、"画布上现在有什么"、
或你需要判断某节点是否已在画布上显示时，先调用本工具确认画布真实状态，再决定是否需要 ADD 动作。
判断"画布上是否存在某节点"必须用 read_canvas，不能用 read_project。

"""
        if canvas_enabled
        else ""
    )
    # 无画布时 read_canvas 节缺失，read_config_file 从 §8 前移为 §7
    read_config_section_num = 8 if canvas_enabled else 7
    canvas_workflow = (
        """4. **画布显示类问题**（如"把 users 表拖到画布"、"显示 orders 约束"）：
   - 先 read_canvas 确认画布真实状态（可能已经显示了）
   - 若画布上没有但配置里有（read_project 确认）→ apply_actions 用 **ADD_TO_CANVAS** 显示
   - 若配置里也没有 → 用 ADD_SCHEMA 等先创建
   - 不要用 read_project 推断画布内容
"""
        if canvas_enabled
        else ""
    )
    # 无画布时"画布显示类"工作流缺失，初始化类从第 5 条前移为第 4 条
    init_workflow_num = 5 if canvas_enabled else 4
    return f"""## 工具使用指引

你有以下 {tool_count} 个工具可用（ask_user 在后文《何时使用 ask_user》单独说明）。
请根据用户需求自主决定调用顺序和次数：

### 1. read_project（查询，无参数）
读取当前项目的完整概览：所有表结构、约束、转换、正则节点、设置。
解析失败的配置文件会列入 parse_errors（文件路径+错误摘要，含 YAML 语法错误与
缺必填字段的严格校验失败）。**配置文件修复回路**：发现 parse_errors 非空、或校验
报 SchemaParseError/"schema 校验失败"中止时——用 read_config_file 读该文件原文，
对照错误指出的字段，用 apply_actions 的对应 UPDATE_* 动作传回完整配置修复
（系统写盘会自动补全缺失字段，如 schema 缺 source.mode：UPDATE_SCHEMA 把原 source
原样传回即可；若自行填写 source.mode，取值只能是 relative_file/absolute_file，
不要用其他值），修复后 validate_table 重新校验确认。损坏的配置文件应主动修复，
不要只向用户报告问题后等待指示。
**使用时机**：用户询问"有哪些表"、"某表有哪些约束"、"当前配置"等查询类问题时，先调用此工具。

### 2. list_data_files（查询，无参数）
扫描项目目录，列出磁盘上所有数据文件（CSV/Excel/JSON 等），并标注每个文件
是否已被 schema 注册（registered/registered_by）。
**使用时机**：用户说"根据目录下的文件/表初始化项目或校验配置"、"分析文件夹里的数据"，
或 read_project 显示项目为空但用户提到了数据文件时，先调用此工具发现文件，
再为未注册（registered=false）的文件建表（先 infer_schema 出列定义草稿，
ADD_SCHEMA 的 source.path 用返回的 path 值，详见"工作流程"第 {init_workflow_num} 条）。
**与 read_project 的关键区别**：read_project 只读已注册到 manifest 的配置；
list_data_files 看的是磁盘上实际存在的文件——包括还没注册进项目的。

### 3. read_table（查询，参数: table_name, sample_rows?）
读取指定表的数据样本（前 N 行）和列结构。
**使用时机**：需要为某列设计约束（如 Range/AllowedValues）时，先看真实数据分布再决定参数。

### 4. infer_schema（查询，参数: file_path, table_name?）
对项目内的数据文件（CSV/Excel/JSON）确定性推断 schema 草稿：返回每列的名称和
推断类型（string/integer/float/boolean/date）。
**使用时机**：为数据文件建表（ADD_SCHEMA）前，**必须**先调用本工具获得列定义草稿，
再按业务语义微调后作为 schemaSpec.columns 提交。典型微调：金额/单价列把 float 改
decimal、主键列补 primary_key: true、按业务语义命名表名（table_name 参数）。
**禁止凭记忆直接手写列类型**——推断草稿是基于真实数据的确定结果，你的调整只是
增量修改。file_path 用 list_data_files 返回的相对项目根 path。

### 5. apply_actions（修改，参数: actions）
执行配置修改动作。actions 是动作列表，每个动作含 actionType 和对应 spec。
**使用时机**：用户明确要求添加/修改/删除约束、表结构、正则、转换或设置时。
**关键区分**：
- 想创建新配置文件（磁盘上没有）→ 用 ADD_SCHEMA/ADD_REGEX 等。
{apply_canvas_note}**注意**：纯查询类问题绝不调用此工具。
**批次依赖（重要）**：预验证按**当前磁盘状态**逐条校验动作，不会模拟同批次
先序动作的效果。因此"补 schema 列/建表"与"依赖该列的约束"必须**分两批提交**：
第一批只写结构，执行成功后再提交第二批挂约束——混在一批会被整批以
"字段不存在"拒绝。

### 6. validate_table（校验，参数: table_name?）
执行数据校验，返回错误数量和列表。不传 table_name 校验所有表。
**使用时机**：用户要求"校验项目/表"，或在 apply_actions 后想验证改动效果。
校验因配置文件加载错误（SchemaParseError 等）中止时，结果会附修复指引——
按指引用 read_config_file 查看该文件原文，用对应 UPDATE_* 动作修复后重新校验。

{read_canvas_section}### {read_config_section_num}. read_config_file（查询，参数: file_path, offset?, length?）
读取项目内文本文件（yaml/yml/json/jsonl/ndjson/md/txt/csv/tsv）的**原文**。
read_project 返回的是解析后的结构化概览，本工具读的是文件原始内容。
**使用时机**：
- read_project 的 parse_errors 报某配置文件解析失败时，读该文件原文定位问题
  （YAML 语法错误、缩进、字段拼写、序列化异常）；
- 需要核对配置文件的真实字段/格式细节（如用户说"schema 文件里写的和界面上不一致"）；
- 读取项目内的说明文档（md/txt）或小型数据文件内容。
**注意**：返回超过长度上限会标注 truncated/total_length/next_offset，
用 next_offset 作为下次调用的 offset 分段读完，不要反复猜路径重读。

## 工作流程

1. **查询类问题**（如"有哪些表"）：read_project → 用自然语言回答，不要 apply_actions。
2. **修改类问题**（如"给 email 加唯一约束"）：
   - 如需确认结构：先 read_project 或 read_table
   - apply_actions 执行修改
   - 可选：validate_table 验证效果
   - 用自然语言总结结果
3. **校验类问题**（如"校验数据"）：直接 validate_table → 用自然语言汇报结果。
{canvas_workflow}{init_workflow_num}. **初始化类问题**（如"根据目录下的文件初始化校验配置"、"分析文件夹里的数据"）：
   - 先 list_data_files 发现磁盘上的数据文件（未注册的 registered=false）
   - 对每个未注册文件建表：先 infer_schema 获得列定义草稿（列名+推断类型），
     按业务语义微调（金额/单价列把 float 改 decimal、主键列补 primary_key: true）
     后 ADD_SCHEMA（schemaSpec 给 name + source.path 用返回的 path，columns 用
     微调后的列定义）。**不要凭记忆手写列类型**——必须以推断草稿为基准做增量调整。
     建表后可用 read_table 查看真实数据分布
   - 再按用户需求设计约束（可先 read_table 看数据分布）；**schema 结构变更与
     约束添加分两批 apply_actions 提交**（见 apply_actions 的批次依赖说明），
     不要混在一个批次里
   - 注意逐批确认规模：文件很多时先列出清单向用户确认范围，不要一次倾倒全部

## 终止条件

当你准备好回答用户、不再需要调用任何工具时，直接输出自然语言文本（不带 tool_calls），
循环即结束，该文本会作为最终回复返回给用户。回答应简洁明了。"""


# 措辞规范（复用自原 chat_system_prompt）
_WORDING_RULES = """## 措辞规范

- 当执行了修改操作时：使用"我将..."、"准备..."等未来时态描述即将执行的动作。
  ❌ 错误："已为 email 添加唯一约束"
  ✅ 正确："我将为 email 添加唯一约束"
- 当汇报校验结果时：客观陈述错误数量和内容，不夸大不缩小。"""


# ask_user 工具使用指引（canvas_enabled=False 时剔除 read_canvas/canvas 引用）
def _build_ask_user_guide(canvas_enabled: bool) -> str:
    """构建 ask_user 使用指引。

    canvas_enabled=False（无画布客户端）时：可推断来源不列 read_canvas，
    "已有信息"不提 canvas——工具面里本就没有画布可查。
    """
    infer_sources = "read_project/read_table/read_canvas" if canvas_enabled else "read_project/read_table"
    context_answer = (
        "答案在 context.selectedNodes 或 canvas 已有信息里"
        if canvas_enabled
        else "答案在 context.selectedNodes 已有信息里"
    )
    return f"""## 何时使用 ask_user

ask_user 用于获取无法自行查到的信息或让用户做决策。**能自己查到的不要问**。

该问的情况：
- 用户意图存在多方案需要抉择（"用 A 还是 B？"）→ choice 类型
- 关键参数缺失且无法从 {infer_sources} 推断（如目标列名歧义）→ value 或 choice 类型
- 执行不可逆的批量非写盘操作前确认意图 → confirm 类型
- 需要用户提供开放式信息（如业务规则说明）→ free_text 类型

不该问的情况：
- 能通过 read_project 查到的表/列信息
- 能通过 list_data_files 查到的项目目录数据文件清单
- 能通过 read_table 推断的数据特征
- 能通过 read_config_file 直接读取的项目内文件原文
- {context_answer}

返回值：observation 含 answer 字段。用户可能跳过（skipped:true）——此时不要反复追问，
基于已知信息尽力继续或明确说明无法完成的原因。"""


# "ADD_TO_CANVAS vs ADD_* 的关键区分"整节（仅画布客户端注入）
_CANVAS_DISTINCTION_SECTION = """## ADD_TO_CANVAS vs ADD_* 的关键区分（最容易出错，务必牢记）

- **ADD_TO_CANVAS**：项目配置文件里**已有**该资源，只是没显示在画布上 → 只读，不写盘。
- **ADD_SCHEMA / ADD_REGEX 等**：项目配置文件里**没有**该资源，需要**新建文件** → 会写盘。

判断流程（用户说"把 X 拖到/放到/显示在画布"时）：
1. 先 read_project 确认 X 在配置文件里是否已存在。
2. 已存在 → 用 **ADD_TO_CANVAS**（绝不写盘，不弹写盘确认）。
3. 不存在 → 用 ADD_SCHEMA 等创建（会写盘，需用户确认）。

❌ 错误：配置里已有 users 表，用户说"拖到画布"，却调 ADD_SCHEMA（会触发"文件已存在"失败或无谓的写盘确认）。
✅ 正确：配置里已有 users 表，用户说"拖到画布" → 调 ADD_TO_CANVAS。"""


def build_chat_agent_system_prompt(canvas_enabled: bool = True) -> str:
    """构建 chat agent 系统提示词（按客户端有无画布两态构建）。

    canvas_enabled=False（无画布客户端，CLI）时三通道联动隔离：
    - CORE 基底 / 工具指引 / ask_user 指引均取无画布变体（见各构建函数）
    - 动作清单与 spec 映射经 exclude_categories 排除 canvas 类动作（计数同步收紧）
    - 省略"ADD_TO_CANVAS vs ADD_*"整节，使用策略/防误操作剔除画布条目
    """
    exclude_canvas: frozenset[str] | set[str] | None = None if canvas_enabled else {"canvas"}
    # 可选值计数与动作清单同源：排除 canvas 类动作后按过滤后规模计数（不硬编码数字）
    action_count = ACTION_COUNT if canvas_enabled else ACTION_COUNT - len(CANVAS_ACTION_TYPES)
    inline_note_tail = "，画布节点与文件一一对应" if canvas_enabled else ""
    canvas_guardrail = (
        '- **不要把"拖到画布"误用为 ADD_SCHEMA**：当用户想把已存在的资源显示到画布时，使用 ADD_TO_CANVAS；'
        "只有资源不存在时才使用 ADD_SCHEMA/ADD_REGEX/ADD_TRANSFORM。\n"
        if canvas_enabled
        else ""
    )
    sections: list[str] = [
        build_system_prompt_core(canvas_enabled),
        f"""---

# Chat Agent 模式说明

你现在处于 Agent 工具调用模式。你不直接输出 JSON，而是：
- 调用工具完成查-改-验，最后用**自然语言文本**（不带 tool_calls）回复用户。

你可以通过调用工具查询项目信息、修改配置、校验数据。请根据用户需求自主决定如何组合使用工具。

{_build_tool_guide(canvas_enabled)}""",
        _WORDING_RULES,
        _build_ask_user_guide(canvas_enabled),
        f"""## actions 格式说明

调用 apply_actions 时，actions 数组中每个元素必须含 actionType 和对应的 spec 字段。
actionType 可选值（{action_count}种）：
{build_action_type_list_text(exclude_categories=exclude_canvas)}

每个动作需带对应 spec 字段：
{build_spec_field_mapping_text(exclude_categories=exclude_canvas)}""",
    ]
    if canvas_enabled:
        sections.append(_CANVAS_DISTINCTION_SECTION)
    sections.extend(
        [
            f"""## 约束类型与参数说明（关键）

调用 ADD_CONSTRAINT_NODE / UPDATE_CONSTRAINT_NODE 时，constraintSpec.type 必须是以下之一，
constraintSpec.params 按类型填充对应字段：

{build_constraint_param_docs_text()}""",
            """## 字段解析约定

- `tableName` / `targetColumn`：可使用表名/列名（中文或英文），系统会自动解析为对应 ID。
- 如不确定 ID，留空 `targetNodeId` / `targetColumnId`，系统从 `tableName` / `targetColumn` 解析。
- `isInline`：默认 false（创建独立约束文件）。仅当用户明确要求"内联约束/存入表配置"时设 true。
- `constraintId`：可选。缺省由系统自动生成唯一 ID，无需填写；仅当用户明确指定 ID 或需要精确更新/删除既有约束时给出（可从项目概览的约束清单或文件名获取）。""",
            f"""## 使用策略

- **默认创建独立约束文件** (`isInline: false`)：独立文件是独立可引用的配置实体{inline_note_tail}
- **只有当用户明确要求"内联约束"、"存在表配置里"时**，才设置 `isInline: true`
- 如果用户说"删除 XXX 约束"，请使用 DELETE_CONSTRAINT_NODE，且 `isInline` 必须与该约束的实际存储形态一致（内联约束 → true，独立约束 → false）
- 必须确保 `tableName` 和 `targetColumn` 准确无误""",
            f"""## 防止误操作（务必遵守）

- **只改用户明确要求的资源**：不要主动添加、修改或删除无关的约束、表结构、正则节点、转换节点或设置。
- **不要重命名或重建 schema 文件**：除非用户明确要求重命名，否则使用现有 schema 的 tableName/id，直接修改对应文件。
- **不要删除已有约束**：除非用户明确说"删除"、"替换"或"去掉"，否则保留已有约束。
- **不要重复创建**：如果某列已存在同类型约束，请在回复中说明，不要再次创建。
- **格式校验优先用约束**："为 X 添加格式校验"应使用 ADD_CONSTRAINT_NODE（type=Scripted，params.pattern 为正则）或 ADD_REGEX，仅操作目标列。
- **一次只做一个明确修改**：如果用户只提到一个字段（如"为 email 添加格式校验"），你的 actions 列表中只能包含针对该字段的写操作。严禁同时添加 age 的 Range 约束、重建 users schema 或删除其他约束。若该字段已存在同类型约束，直接说明即可，不要生成新动作。
- **禁止照搬示例参数**：示例中的 `min: 0, max: 100` 只是参数格式说明，不要为未提及的字段创建 Range 约束。
{canvas_guardrail}- **填写 intent_scope（写动作必填）**：调用 apply_actions 时，凡含写动作（ADD/UPDATE/DELETE_*），必须在 intent_scope 中声明你理解的用户意图所涉及的表和列。这是防止越界修改的安全门——后端会校验 actions 的写目标是否全部在 intent_scope 内，越界将被拒绝。例：用户说"给邮箱加格式校验"（邮箱=email），intent_scope 填 `{{"tables":["users"],"columns":[{{"table":"users","column":"email"}}]}}`；用户说"删除 users 表的所有约束"，intent_scope 填 `{{"tables":["users"]}}`。中文到字段名的映射（邮箱→email）由你完成，后端只做精确比对。""",
        ]
    )
    return "\n\n".join(sections)


# 默认（有画布）变体：GUI 流式/非流式两通道共用，保持既有导入方行为不变；
# 无画布环境（CLI）经 build_chat_agent_system_prompt(canvas_enabled=False) 构建隔离变体
CHAT_AGENT_SYSTEM_PROMPT = build_chat_agent_system_prompt()


# =============================================================================
# 运行结果
# =============================================================================


@dataclass
class ChatAgentRunResult:
    """Chat Agent 单次运行的产出

    reply: 最终回复给用户的自然语言文本
    frontend_instructions: apply_actions 旁路累积的前端指令列表
    actions: 已执行的动作列表（用于审计，可空）
    tool_steps: 工具调用轨迹（有序的工具名 + 简要描述列表，供前端展示）
    iterations: 实际迭代轮数
    success: 是否成功完成
    error: 失败时的错误信息
    """

    reply: str
    frontend_instructions: list[Any] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)
    tool_steps: list[dict[str, Any]] = field(default_factory=list)
    iterations: int = 0
    success: bool = True
    error: str | None = None


# =============================================================================
# Runner 核心
# =============================================================================


class ChatAgentRunner:
    """
    @classdesc Chat Agent 编排器

    组装工具 → 构建提示词 → 调用 AgentExecutor → 提取结果。
    对 ChatOrchestrator 屏蔽 AgentExecutor 的内部细节。
    """

    def __init__(
        self,
        provider: Any,
        project_path: str,
        context_nodes: list[dict[str, Any]],
        max_iterations: int | None = None,
        max_history_tokens: int | None = None,
        confirm_controller: Any | None = None,
        apply_callbacks: ApplyCallbacks | None = None,
        ask_callbacks: AskCallbacks | None = None,
        dry_run_enabled: bool = False,
        job_id: str = "",
        canvas_nodes: list[dict[str, Any]] | None = None,
        canvas_enabled: bool = True,
    ):
        """
        @methoddesc 初始化 Chat Agent Runner

        参数:
            provider: Provider 实例（BaseProvider 子类，有 chat 方法），由调用方通过 create() 创建
            project_path: 项目配置目录路径
            context_nodes: 前端选中的上下文节点列表
            max_iterations: Agent 最大迭代轮数。None（缺省）时回退到用户级配置
                ~/.precis/ai_providers.yaml 的 chat.max_agent_iterations（配置不可用
                时再回退默认常量，见 _resolve_max_agent_iterations）；显式传入则
                尊重调用方预算
            max_history_tokens: 历史消息 token 预算。None（缺省）时在 run 阶段按
                provider 上下文窗口自适应推导（resolve_chat_history_budget），
                显式传入则尊重调用方预算（CLI 已自行按窗口计算后传入）
            confirm_controller: （已废弃）旧的单 job 控制器；保留兼容但不再用于门控
            apply_callbacks: apply_* 事件回调集合
            ask_callbacks: ask_user 事件回调集合（仅流式路径启用交互）
            dry_run_enabled: 是否启用两阶段确认模式
            job_id: 当前任务 ID，供 ApplyActionsTool 生成 apply_id
            canvas_nodes: 前端请求体携带的画布节点快照（已裁剪），供 read_canvas 工具查询。
                区别于 context_nodes（用户右键选中的少数节点），canvas_nodes 是全部画布业务节点。
            canvas_enabled: 客户端是否有画布。False（CLI 等无画布终端）时 read_canvas
                不注册、apply_actions 剔除 canvas 类动作（ADD_TO_CANVAS）、系统提示词
                取无画布变体；GUI 两通道缺省 True（行为不变）
        """
        self.provider = provider
        self.project_path = project_path
        self.context_nodes = context_nodes
        # 预算优先级：显式传参 > 用户级 chat.max_agent_iterations 配置 > 默认常量
        # （None 表示调用方未显式指定，统一经 _resolve_max_agent_iterations 回退）
        self.max_iterations = _resolve_max_agent_iterations() if max_iterations is None else max_iterations
        self.max_history_tokens = max_history_tokens
        self.confirm_controller = confirm_controller
        self.apply_callbacks = apply_callbacks or ApplyCallbacks()
        self.ask_callbacks = ask_callbacks or AskCallbacks()
        self.dry_run_enabled = dry_run_enabled
        self.job_id = job_id
        self.canvas_nodes = canvas_nodes or []
        self.canvas_enabled = canvas_enabled

        # 关键：frontend_instructions 的旁路累积容器
        # apply_actions 工具持有此列表引用，append 后 runner 最终读取
        self.collected_instructions: list[Any] = []

        # 流式回调容器：由 StreamingOrchestrator 通过 configure_callbacks 注入，
        # run 时透传给 AgentExecutor（未配置时为空，executor 用默认 noop）。
        self._callbacks: dict[str, Any] = {}

        # 组装系统提示词（含上下文）
        self.system_prompt = self._build_system_prompt()

    def configure_callbacks(self, **kwargs: Any) -> None:
        """@methoddesc 配置流式回调，run 时透传给 AgentExecutor。

        由 StreamingOrchestrator 调用，把 on_chunk/on_turn/on_tool_call/on_tool_result/cancelled
        注入，实现 service 输出 → 事件流的桥接。未配置的回调在 executor 内部使用默认 noop。

        参数:
            **kwargs: 回调键值对，支持的键: on_chunk, on_turn, on_tool_call, on_tool_result, cancelled
        """
        self._callbacks = kwargs

    def _build_system_prompt(self) -> str:
        """
        @methoddesc 构建完整的 chat agent 系统提示词

        在基础 agent 提示词后，附加当前项目概览和选中上下文，
        让 LLM 开局即了解项目状态（但仍可用 read_project 刷新）。
        """
        from app.shared.services.ai.utils import get_project_overview
        from app.shared.services.llm.chat.chat_system_prompt import (
            build_context_section,
            build_project_overview_section,
        )

        parts = [build_chat_agent_system_prompt(self.canvas_enabled)]

        # 附加项目概览（让 LLM 无需首轮必调 read_project）
        try:
            overview = get_project_overview(self.project_path)
            overview_section = build_project_overview_section(overview)
            if overview_section:
                parts.append(overview_section)
        except Exception as e:
            logger.warning(f"构建项目概览失败，LLM 可自行调用 read_project: {e}")

        # 附加选中上下文节点
        context_section = build_context_section(self.context_nodes)
        if context_section:
            parts.append(context_section)

        return "\n\n".join(parts)

    def _create_registry(self, user_message: str = "") -> ToolRegistry:
        """
        @methoddesc 创建并注册 chat 工具集

        有画布客户端 9 个工具：read_project/list_data_files/read_table/infer_schema/
        read_config_file 注入 project_path，read_canvas 注入画布节点快照，
        ask_user 注入交互回调（仅流式路径启用）。
        无画布客户端（canvas_enabled=False，CLI）8 个：read_canvas 不注册。
        apply_actions 额外注入 collected_instructions 共享引用 + 当前用户消息（用于意图范围校验）。
        """
        registry = ToolRegistry()

        # 工具注册统一走 register_tool；只读工具显式标 read_only（execute_many 并发分流）
        registry.register_tool(
            ReadProjectTool(project_path=self.project_path),
            read_only=True,
            args_model=MODEL_FOR_TOOL.get(ReadProjectTool.NAME),
        )
        registry.register_tool(
            ListDataFilesTool(project_path=self.project_path),
            read_only=True,
            args_model=MODEL_FOR_TOOL.get(ListDataFilesTool.NAME),
        )
        registry.register_tool(
            ReadTableTool(project_path=self.project_path),
            read_only=True,
            args_model=MODEL_FOR_TOOL.get(ReadTableTool.NAME),
        )

        # infer_schema：对数据文件确定性推断 schema 草稿（只读），建表工作流的前置步骤
        registry.register_tool(
            InferSchemaTool(project_path=self.project_path),
            read_only=True,
            args_model=MODEL_FOR_TOOL.get(InferSchemaTool.NAME),
        )

        # read_config_file：读取项目内文本文件原文（只读），诊断配置解析失败/核对文件真实内容
        registry.register_tool(
            ReadConfigFileTool(project_path=self.project_path),
            read_only=True,
            args_model=MODEL_FOR_TOOL.get(ReadConfigFileTool.NAME),
        )

        # 关键：apply_actions 注入 collected_instructions 共享引用 + 两阶段确认参数
        # 同时传入 user_message，用于工具内部做意图范围校验，防止 LLM 越界修改。
        # job_id 用于生成 apply_id（"{job_id}#{seq}"），每次 apply 创建独立确认控制器
        # apply_actions 是写盘工具（read_only 默认 False），execute_many 会串行化同轮多个 apply
        registry.register_tool(
            ApplyActionsTool(
                project_path=self.project_path,
                collected_instructions=self.collected_instructions,
                dry_run_enabled=self.dry_run_enabled,
                apply_callbacks=self.apply_callbacks,
                job_id=self.job_id,
                user_message=user_message,
                canvas_enabled=self.canvas_enabled,
            ),
            args_model=MODEL_FOR_TOOL.get(ApplyActionsTool.NAME),
        )

        registry.register_tool(
            ValidateTableTool(project_path=self.project_path),
            read_only=True,
            args_model=MODEL_FOR_TOOL.get(ValidateTableTool.NAME),
        )

        # read_canvas：注入前端请求体携带的画布节点快照，供 LLM 查询画布真实状态。
        # 无画布环境（canvas_enabled=False，CLI）不注册——注册了也只能永远读到空画布，
        # 反而诱导 LLM 产生"画布存在且为空"的错觉并提议画布动作
        if self.canvas_enabled:
            registry.register_tool(
                ReadCanvasTool(canvas_nodes=self.canvas_nodes),
                read_only=True,
                args_model=MODEL_FOR_TOOL.get(ReadCanvasTool.NAME),
            )

        # ask_user：交互问答工具，注入 ask_callbacks 与 dry_run_enabled
        # ask_user 不写盘（标 read_only），与其他工具同轮调用时并发安全
        registry.register_tool(
            AskUserTool(
                job_id=self.job_id,
                ask_callbacks=self.ask_callbacks,
                dry_run_enabled=self.dry_run_enabled,
            ),
            read_only=True,
            args_model=MODEL_FOR_TOOL.get(AskUserTool.NAME),
        )

        return registry

    # 工具名到人类可读标签的映射，用于前端展示轨迹
    _TOOL_LABELS = {
        ReadProjectTool.NAME: "读取项目",
        ListDataFilesTool.NAME: "发现数据文件",
        ReadTableTool.NAME: "查看数据",
        InferSchemaTool.NAME: "推断表结构",
        ApplyActionsTool.NAME: "修改配置",
        ValidateTableTool.NAME: "校验数据",
        ReadCanvasTool.NAME: "读取画布",
        ReadConfigFileTool.NAME: "读取配置文件",
        AskUserTool.NAME: "询问用户",
    }

    def _collect_audit_trail(self, agent_result: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """
        @methoddesc 从 agent 执行记录中收集审计轨迹

        返回两个列表：
        - executed_actions: 所有 apply_actions 工具调用中的 actions 参数（扁平化）
        - tool_steps: 工具调用轨迹（每步含 tool 名、标签、轮次、成败），供前端展示

        成败信息取自与 tool_calls 同序的 tool_results（executor 用 asyncio.gather
        保持顺序挂载）。按下标对齐匹配，而非 name/call_id——因为 execute_many 的
        异常兜底分支产生的 ToolResult 其 call_id/name 为空，无法用字段匹配。
        缺失对应 result 时（边界情况）回退为 success，避免历史数据显示未知状态。
        """
        executed: list[dict[str, Any]] = []
        tool_steps: list[dict[str, Any]] = []
        for turn in agent_result.turns:
            results = turn.tool_results
            for i, tc in enumerate(turn.tool_calls):
                label = self._TOOL_LABELS.get(tc.name, tc.name)
                step: dict[str, Any] = {"tool": tc.name, "label": label, "turn": turn.turn}
                # 按下标取同序 tool_result，提取成败（B3 路径 A：后端保留成败）
                if i < len(results):
                    tr = results[i]
                    step["status"] = "success" if tr.success else "failed"
                    if tr.error:
                        step["error"] = tr.error
                else:
                    # 缺失 result 回退为 success（边界兜底）
                    step["status"] = "success"
                # apply_actions 额外记录动作数量与动态标签
                if tc.name == ApplyActionsTool.NAME:
                    args = tc.arguments
                    if isinstance(args, dict):
                        actions = args.get("actions", [])
                        if isinstance(actions, list):
                            executed.extend(actions)
                            step["action_count"] = len(actions)
                            # 动态标签：全是只读动作时显示"显示到画布"，而非笼统的"修改配置"
                            # 避免用户看到"拖入画布"操作却显示"修改配置"的困惑
                            action_types = [a.get("actionType", "") for a in actions if isinstance(a, dict)]
                            if action_types and all(t in _READ_ONLY_LABEL_TYPES for t in action_types):
                                # 进一步细分：全是 ADD_TO_CANVAS 显示"显示到画布"，全是 VALIDATE 显示"校验数据"
                                # （无画布环境 canvas 动作已被拦截，不会出现该分支的画布标签）
                                if self.canvas_enabled and all(t == "ADD_TO_CANVAS" for t in action_types):
                                    step["label"] = "显示到画布"
                                elif all(t == "VALIDATE_PROJECT" for t in action_types):
                                    step["label"] = "校验数据"
                                else:
                                    step["label"] = "查询操作"
                tool_steps.append(step)
        return executed, tool_steps

    async def run(self, message: str, history: list[dict[str, str]] | None = None) -> ChatAgentRunResult:
        """
        @methoddesc 运行 Chat Agent

        组装 registry + executor，跑工具循环，提取结果。

        参数:
            message: 用户消息
            history: 对话历史（可选，用于多轮上下文）

        返回:
            ChatAgentRunResult: 含 reply、frontend_instructions、actions 等
        """
        registry = self._create_registry(user_message=message)

        # 构建任务消息：用户消息 + 历史摘要
        task_message = self._build_task_message(message, history)

        # 历史预算：显式传入优先；缺省(None)时按 provider 实际上下文窗口自适应推导
        # （小窗口收缩预算，探测失败回退默认上限），与 orchestrator 旧路径共用同一来源
        if self.max_history_tokens is None:
            from app.shared.services.ai.utils import estimate_tokens, resolve_chat_history_budget

            # 工具定义与系统提示词同属每轮固定开销：按 OpenAI tools JSON 序列化后
            # 用 estimate_tokens 估算并从输入预算扣除。estimate_tokens 对 JSON 标点
            # 逐字符计数，天然比真实 BPE 偏多——宁可少算历史，不可挤爆窗口
            tools_json = json.dumps(registry.get_definitions(), ensure_ascii=False)
            self.max_history_tokens = await resolve_chat_history_budget(
                self.provider,
                tool_definitions_tokens=estimate_tokens(tools_json),
            )

        executor = AgentExecutor(
            provider=self.provider,
            registry=registry,
            system_prompt=self.system_prompt,
            max_iterations=self.max_iterations,
            max_tokens=self.max_history_tokens,
            # 流式回调透传（未配置时为 None，AgentExecutor 内部用默认 noop）
            on_chunk=self._callbacks.get("on_chunk"),
            on_turn=self._callbacks.get("on_turn"),
            on_tool_call=self._callbacks.get("on_tool_call"),
            on_tool_result=self._callbacks.get("on_tool_result"),
            cancelled_callback=self._callbacks.get("cancelled"),
            # chat agent 无最终输出工具，跳过最终配置提取（chat 靠无 tool_calls 自然终止）
            final_output_tool=None,
        )

        try:
            agent_result = await executor.run(task_message)
        except Exception as e:
            logger.exception("ChatAgentRunner 执行失败")
            return ChatAgentRunResult(
                reply="抱歉，我在处理时遇到了问题，请稍后重试。",
                frontend_instructions=[],
                success=False,
                error=f"Agent 执行失败: {e}",
            )

        # 提取最终回复（无 tool_calls 的最后一轮 content）
        reply = agent_result.content or ""
        if not reply:
            # 兜底：循环用尽但仍无文本回复
            if agent_result.error:
                reply = f"处理未能完成：{agent_result.error}"
            else:
                reply = "我已完成处理，但没有生成回复文本。"

        # 收集审计轨迹（已执行动作 + 工具步骤）
        executed_actions, tool_steps = self._collect_audit_trail(agent_result)

        return ChatAgentRunResult(
            reply=reply,
            frontend_instructions=list(self.collected_instructions),
            actions=executed_actions,
            tool_steps=tool_steps,
            iterations=agent_result.iterations,
            success=agent_result.success,
            error=agent_result.error,
        )

    def _build_task_message(self, message: str, history: list[dict[str, str]] | None) -> str:
        """
        @methoddesc 构建 Agent 任务消息

        AgentExecutor.run 的 task_message 会作为初始 user 消息。
        在用户原始消息前，附加简要的历史摘要（如有），
        让 Agent 在多轮对话中保持上下文。
        """
        if not history:
            return message

        # 截取最近几轮历史作为摘要（避免 task_message 过长）
        recent = history[-6:]  # 最近 3 轮（user+assistant 各算一条）
        if not recent:
            return message

        history_lines = []
        for msg in recent:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "user":
                history_lines.append(f"用户: {content}")
            elif role == "assistant":
                history_lines.append(f"助手: {content}")

        history_text = "\n".join(history_lines)
        return f"## 对话历史摘要\n{history_text}\n\n## 当前用户需求\n{message}"
