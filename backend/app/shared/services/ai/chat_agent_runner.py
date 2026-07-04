"""@fileoverview Chat Agent Runner 模块

Chat mini-agent 的编排器。在 agent_mode=true 时，
让 Chat 路径真正跑起 plan→act→observe 工具循环。

核心职责:
- 组装 5 个 chat 专用工具(read_project/read_table/apply_actions/validate_table/read_canvas)
- 构建 chat agent 系统提示词
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

import logging
from dataclasses import dataclass, field
from typing import Any

from app.shared.services.ai.agent.chat_tools import (
    ApplyActionsTool,
    AskUserTool,
    ReadCanvasTool,
    ReadProjectTool,
    ReadTableTool,
    ValidateTableTool,
)
from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyCallbacks
from app.shared.services.ai.agent.chat_tools.ask_user import AskCallbacks
from app.shared.services.ai.agent.executor import AgentExecutor
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.llm.actions.registry import (
    ACTION_COUNT,
    READ_ONLY_ACTION_TYPES,
    build_action_type_list_text,
    build_spec_field_mapping_text,
)
from app.shared.services.llm.chat.chat_system_prompt import SYSTEM_PROMPT_CORE

logger = logging.getLogger(__name__)

# 只读动作类型集合（用于动态标签判断，从注册表派生）
_READ_ONLY_LABEL_TYPES = READ_ONLY_ACTION_TYPES


# =============================================================================
# 系统提示词
# =============================================================================

# 工具使用指引：定义 LLM 如何使用 5 个工具完成查-改-验闭环
_CHAT_AGENT_TOOL_GUIDE = """## 工具使用指引

你有以下 5 个工具可用。请根据用户需求自主决定调用顺序和次数：

### 1. read_project（查询，无参数）
读取当前项目的完整概览：所有表结构、约束、转换、正则节点、设置。
**使用时机**：用户询问"有哪些表"、"某表有哪些约束"、"当前配置"等查询类问题时，先调用此工具。

### 2. read_table（查询，参数: table_name, sample_rows?）
读取指定表的数据样本（前 N 行）和列结构。
**使用时机**：需要为某列设计约束（如 Range/AllowedValues）时，先看真实数据分布再决定参数。

### 3. apply_actions（修改，参数: actions）
执行配置修改动作。actions 是动作列表，每个动作含 actionType 和对应 spec。
**使用时机**：用户明确要求添加/修改/删除约束、表结构、正则、转换或设置时。
**关键区分**：
- 想创建新配置文件（磁盘上没有）→ 用 ADD_SCHEMA/ADD_REGEX 等。
- 想"把已存在的资源显示到画布上"（配置文件已有，但画布上没显示）→ 用 **ADD_TO_CANVAS**
  （actionType=ADD_TO_CANVAS，spec 含 resourceKind: schema/regex/constraint/transform
  和 resourceId/resourceName）。ADD_TO_CANVAS 不写盘，只把现有配置显示到画布。
**注意**：纯查询类问题绝不调用此工具。

### 4. validate_table（校验，参数: table_name?）
执行数据校验，返回错误数量和列表。不传 table_name 校验所有表。
**使用时机**：用户要求"校验项目/表"，或在 apply_actions 后想验证改动效果。

### 5. read_canvas（查询，无参数）
读取当前**画布上实际显示**的节点列表（Schema、约束、正则、转换等），含各类数量摘要。
**与 read_project 的关键区别**：read_project 读项目配置文件，read_canvas 读画布快照——
项目配置里有的表/约束不一定已拖到画布上，两者会不一致。
**使用时机**：当用户说"画布上有没有 X"、"把 Y 放到画布/拖到画布"、"画布上现在有什么"、
或你需要判断某节点是否已在画布上显示时，先调用本工具确认画布真实状态，再决定是否需要 ADD 动作。
判断"画布上是否存在某节点"必须用 read_canvas，不能用 read_project。

## 工作流程

1. **查询类问题**（如"有哪些表"）：read_project → 用自然语言回答，不要 apply_actions。
2. **修改类问题**（如"给 email 加唯一约束"）：
   - 如需确认结构：先 read_project 或 read_table
   - apply_actions 执行修改
   - 可选：validate_table 验证效果
   - 用自然语言总结结果
3. **校验类问题**（如"校验数据"）：直接 validate_table → 用自然语言汇报结果。
4. **画布显示类问题**（如"把 users 表拖到画布"、"显示 orders 约束"）：
   - 先 read_canvas 确认画布真实状态（可能已经显示了）
   - 若画布上没有但配置里有（read_project 确认）→ apply_actions 用 **ADD_TO_CANVAS** 显示
   - 若配置里也没有 → 用 ADD_SCHEMA 等先创建
   - 不要用 read_project 推断画布内容

## 终止条件

当你准备好回答用户、不再需要调用任何工具时，直接输出自然语言文本（不带 tool_calls），
循环即结束，该文本会作为最终回复返回给用户。回答应简洁明了。"""

# 措辞规范（复用自原 chat_system_prompt）
_WORDING_RULES = """## 措辞规范

- 当执行了修改操作时：使用"我将..."、"准备..."等未来时态描述即将执行的动作。
  ❌ 错误："已为 email 添加唯一约束"
  ✅ 正确："我将为 email 添加唯一约束"
- 当汇报校验结果时：客观陈述错误数量和内容，不夸大不缩小。"""

# ask_user 工具使用指引
_ASK_USER_GUIDE = """## 何时使用 ask_user

ask_user 用于获取无法自行查到的信息或让用户做决策。**能自己查到的不要问**。

该问的情况：
- 用户意图存在多方案需要抉择（"用 A 还是 B？"）→ choice 类型
- 关键参数缺失且无法从 read_project/read_table/read_canvas 推断（如目标列名歧义）→ value 或 choice 类型
- 执行不可逆的批量非写盘操作前确认意图 → confirm 类型
- 需要用户提供开放式信息（如业务规则说明）→ free_text 类型

不该问的情况：
- 能通过 read_project 查到的表/列信息
- 能通过 read_table 推断的数据特征
- 答案在 context.selectedNodes 或 canvas 已有信息里

返回值：observation 含 answer 字段。用户可能跳过（skipped:true）——此时不要反复追问，
基于已知信息尽力继续或明确说明无法完成的原因。"""

# 完整的 chat agent 系统提示词
# 注意：SYSTEM_PROMPT_CORE 现已剥离 JSON 输出指令（移至 SYSTEM_PROMPT_JSON_OUTPUT，
# 仅非 Agent 路径用），故 Agent 路径无需 verbal override，直接继承 CORE 的领域能力描述。
CHAT_AGENT_SYSTEM_PROMPT = f"""{SYSTEM_PROMPT_CORE}

---

# Chat Agent 模式说明

你现在处于 Agent 工具调用模式。你不直接输出 JSON，而是：
- 调用工具完成查-改-验，最后用**自然语言文本**（不带 tool_calls）回复用户。

你可以通过调用工具查询项目信息、修改配置、校验数据。请根据用户需求自主决定如何组合使用工具。

{_CHAT_AGENT_TOOL_GUIDE}

{_WORDING_RULES}

{_ASK_USER_GUIDE}

## actions 格式说明

调用 apply_actions 时，actions 数组中每个元素必须含 actionType 和对应的 spec 字段。
actionType 可选值（{ACTION_COUNT}种）：
{build_action_type_list_text()}

每个动作需带对应 spec 字段：
{build_spec_field_mapping_text()}

## ADD_TO_CANVAS vs ADD_* 的关键区分（最容易出错，务必牢记）

- **ADD_TO_CANVAS**：项目配置文件里**已有**该资源，只是没显示在画布上 → 只读，不写盘。
- **ADD_SCHEMA / ADD_REGEX 等**：项目配置文件里**没有**该资源，需要**新建文件** → 会写盘。

判断流程（用户说"把 X 拖到/放到/显示在画布"时）：
1. 先 read_project 确认 X 在配置文件里是否已存在。
2. 已存在 → 用 **ADD_TO_CANVAS**（绝不写盘，不弹写盘确认）。
3. 不存在 → 用 ADD_SCHEMA 等创建（会写盘，需用户确认）。

❌ 错误：配置里已有 users 表，用户说"拖到画布"，却调 ADD_SCHEMA（会触发"文件已存在"失败或无谓的写盘确认）。
✅ 正确：配置里已有 users 表，用户说"拖到画布" → 调 ADD_TO_CANVAS。

## 约束类型与参数说明（关键）

调用 ADD_CONSTRAINT_NODE / UPDATE_CONSTRAINT_NODE 时，constraintSpec.type 必须是以下之一，
constraintSpec.params 按类型填充对应字段：

- **NotNull**: 非空约束。参数：无。
- **Unique**: 唯一约束。参数：无。
- **AllowedValues**: 允许值约束。参数：`allowedValues` (List[Any])。
- **Range**: 范围约束。参数：`min` (float/int), `max` (float/int)。
- **Scripted**: 脚本/正则约束。二选一：`expression` (str, 代码表达式) 或 `pattern` (str, 正则)。
- **ForeignKey**: 外键约束。参数：`toTableId` (str), `toColumnId` (str)。
- **Conditional**: 条件约束。参数：`ifConditions` (List), `thenValue` (Any)。
  - `ifConditions` 结构：`[{{"ifColumnId": "列名", "operator": "eq/ne/gt/lt/in", "value": "比较值"}}]`
- **DateLogic**: 日期逻辑约束。参数：`logicMode` ("compare"/"calculation"), `compareOp` ("gt/lt/eq/gte/lte/range"), `referenceDate` (str, "YYYY-MM-DD"), `referenceColumn` (str)。当 `compareOp` 为 "range" 时，必须同时提供 `referenceDateEnd` 或 `referenceColumnEnd`。
- **Charset**: 字符集约束。
- **Composite**: 组合约束（多列联合）。

## 字段解析约定

- `tableName` / `targetColumn`：可使用表名/列名（中文或英文），系统会自动解析为对应 ID。
- 如不确定 ID，留空 `targetNodeId` / `targetColumnId`，系统从 `tableName` / `targetColumn` 解析。
- `isInline`：默认 true（内联约束，存入表配置）。仅当用户明确要求"独立约束/单独文件"时设 false。

## 使用策略

- **默认创建内联约束** (`isInline: true`)：内联约束直接存储在表配置中，轻量且易于管理
- **只有当用户明确要求"创建独立约束"、"独立节点"或"单独文件"时**，才设置 `isInline: false`
- 如果用户说"删除 XXX 约束"，请使用 DELETE_CONSTRAINT_NODE
- 必须确保 `tableName` 和 `targetColumn` 准确无误"""


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
        max_iterations: int = 5,
        max_history_tokens: int = 120000,
        confirm_controller: Any | None = None,
        apply_callbacks: ApplyCallbacks | None = None,
        ask_callbacks: AskCallbacks | None = None,
        dry_run_enabled: bool = False,
        job_id: str = "",
        canvas_nodes: list[dict[str, Any]] | None = None,
    ):
        """
        @methoddesc 初始化 Chat Agent Runner

        参数:
            provider: Provider 实例（BaseProvider 子类，有 chat 方法），由调用方通过 create() 创建
            project_path: 项目配置目录路径
            context_nodes: 前端选中的上下文节点列表
            max_iterations: Agent 最大迭代轮数
            max_history_tokens: 历史消息 token 预算
            confirm_controller: （已废弃）旧的单 job 控制器；保留兼容但不再用于门控
            apply_callbacks: apply_* 事件回调集合
            ask_callbacks: ask_user 事件回调集合（仅流式路径启用交互）
            dry_run_enabled: 是否启用两阶段确认模式
            job_id: 当前任务 ID，供 ApplyActionsTool 生成 apply_id
            canvas_nodes: 前端请求体携带的画布节点快照（已裁剪），供 read_canvas 工具查询。
                区别于 context_nodes（用户右键选中的少数节点），canvas_nodes 是全部画布业务节点。
        """
        self.provider = provider
        self.project_path = project_path
        self.context_nodes = context_nodes
        self.max_iterations = max_iterations
        self.max_history_tokens = max_history_tokens
        self.confirm_controller = confirm_controller
        self.apply_callbacks = apply_callbacks or ApplyCallbacks()
        self.ask_callbacks = ask_callbacks or AskCallbacks()
        self.dry_run_enabled = dry_run_enabled
        self.job_id = job_id
        self.canvas_nodes = canvas_nodes or []

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

        parts = [CHAT_AGENT_SYSTEM_PROMPT]

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

    def _create_registry(self) -> ToolRegistry:
        """
        @methoddesc 创建并注册 chat 工具集

        6 个工具：read_project/read_table/apply_actions/validate_table 注入 project_path，
        read_canvas 注入画布节点快照，ask_user 注入交互回调（仅流式路径启用）。
        apply_actions 额外注入 collected_instructions 共享引用。
        """
        registry = ToolRegistry()

        read_project_tool = ReadProjectTool(project_path=self.project_path)
        registry.register(
            name=read_project_tool.NAME,
            description=read_project_tool.get_definition()["function"]["description"],
            parameters=read_project_tool.get_definition()["function"]["parameters"],
            handler=lambda args: read_project_tool.run(args),
        )

        read_table_tool = ReadTableTool(project_path=self.project_path)
        registry.register(
            name=read_table_tool.NAME,
            description=read_table_tool.get_definition()["function"]["description"],
            parameters=read_table_tool.get_definition()["function"]["parameters"],
            handler=lambda args: read_table_tool.run(args),
        )

        # 关键：apply_actions 注入 collected_instructions 共享引用 + 两阶段确认参数
        # job_id 用于生成 apply_id（"{job_id}#{seq}"），每次 apply 创建独立确认控制器
        apply_actions_tool = ApplyActionsTool(
            project_path=self.project_path,
            collected_instructions=self.collected_instructions,
            dry_run_enabled=self.dry_run_enabled,
            apply_callbacks=self.apply_callbacks,
            job_id=self.job_id,
        )
        registry.register(
            name=apply_actions_tool.NAME,
            description=apply_actions_tool.get_definition()["function"]["description"],
            parameters=apply_actions_tool.get_definition()["function"]["parameters"],
            handler=lambda args: apply_actions_tool.run(args),
        )

        validate_tool = ValidateTableTool(project_path=self.project_path)
        registry.register(
            name=validate_tool.NAME,
            description=validate_tool.get_definition()["function"]["description"],
            parameters=validate_tool.get_definition()["function"]["parameters"],
            handler=lambda args: validate_tool.run(args),
        )

        # read_canvas：注入前端请求体携带的画布节点快照，供 LLM 查询画布真实状态
        read_canvas_tool = ReadCanvasTool(canvas_nodes=self.canvas_nodes)
        registry.register(
            name=read_canvas_tool.NAME,
            description=read_canvas_tool.get_definition()["function"]["description"],
            parameters=read_canvas_tool.get_definition()["function"]["parameters"],
            handler=lambda args: read_canvas_tool.run(args),
        )

        # ask_user：交互问答工具，注入 ask_callbacks 与 dry_run_enabled
        ask_tool = AskUserTool(
            job_id=self.job_id,
            ask_callbacks=self.ask_callbacks,
            dry_run_enabled=self.dry_run_enabled,
        )
        registry.register(
            name=ask_tool.NAME,
            description=ask_tool.get_definition()["function"]["description"],
            parameters=ask_tool.get_definition()["function"]["parameters"],
            handler=lambda args: ask_tool.run(args),
        )

        return registry

    # 工具名到人类可读标签的映射，用于前端展示轨迹
    _TOOL_LABELS = {
        ReadProjectTool.NAME: "读取项目",
        ReadTableTool.NAME: "查看数据",
        ApplyActionsTool.NAME: "修改配置",
        ValidateTableTool.NAME: "校验数据",
        ReadCanvasTool.NAME: "读取画布",
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
                                if all(t == "ADD_TO_CANVAS" for t in action_types):
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
        registry = self._create_registry()

        # 构建任务消息：用户消息 + 历史摘要
        task_message = self._build_task_message(message, history)

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
