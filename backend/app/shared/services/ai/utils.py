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
"""
@fileoverview AI 服务通用工具函数

功能概述:
- 估算文本 Token 数量（支持中英文混合）
- 按 Token 上限截断聊天历史记录
- 按 Provider 上下文窗口自适应推导聊天历史预算
- 扫描项目目录生成项目概览（Schema / Constraint 列表）

架构设计:
- 纯函数设计，无副作用，便于单元测试
- Token 估算采用字符分类加权策略：中文单字 + 英文单词 + 数字 + 标点
- 项目概览扫描递归读取 schemas/ 和 constraints/ 目录下的 YAML 文件
- 概览对每类配置文件追加严格 File 模型校验（与运行时 reader 同款），
  字段级损坏（如缺 source.mode）与 YAML 语法错误一并记入 parse_errors

输入示例:
    estimate_tokens("Hello 世界")
    truncate_history_by_tokens(history, "系统提示", max_tokens=120000)
    await resolve_chat_history_budget(provider)
    get_project_overview("/path/to/project")

输出示例:
    7  # Token 估算值
    [{"role": "user", "content": "..."}]  # 截断后的历史
    11776  # 自适应推导的历史预算
    {"schemas": [...], "constraints": [...], "parse_errors": [...]}  # 项目概览（parse_errors 为解析/严格校验失败文件清单）
"""

import asyncio
import logging
import re
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ValidationError

from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.regex.types import RegexNodeFile
from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.core.project.transform.types import TransformFile

logger = logging.getLogger(__name__)

# 聊天历史 token 预算的硬上限：与旧版硬编码默认值一致。
# 探测到大窗口时也不放大（避免预算超出内部估算可靠范围），探测失败时作为回退默认值
CHAT_HISTORY_BUDGET_CAP = 120000

# 工具定义 token 的保守预留（调用方未显式传入估算时使用）：
# 9 个 chat 工具的 OpenAI tools JSON（名称/描述/参数 schema）按 estimate_tokens
# 口径序列化实测约 3.4k token（2026-09 实测：9 工具 6556 字符 → 3417；
# read_project/validate_table 描述补"损坏配置修复指引"语义后由 3332 上调；
# estimate_tokens 对 JSON 标点逐字符计数，天然比真实 BPE 偏多）。
# 宁可多预留、少算历史，不可挤爆窗口。
_DEFAULT_TOOL_DEFINITIONS_TOKENS = 3600

# 扣除固定开销（输出预留 + 工具定义）后历史预算的保底下限：低于此值说明窗口已被
# 系统提示词+工具定义挤占，再收缩会让多轮对话"零历史"——保底并告警，由人工
# 更换更大窗口的模型或精简工具集（与探测失败回退同款容错语义，不阻断对话）。
_MIN_HISTORY_BUDGET = 2048


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


async def resolve_chat_history_budget(provider: Any, tool_definitions_tokens: int | None = None) -> int:
    """按 Provider 实际上下文窗口自适应推导聊天历史 token 预算。

    聊天路径（orchestrator 旧路径 + chat agent 路径）的预算单一来源：
    探测 provider 的上下文窗口，经 compute_token_budgets 得到输入预算
    （保证 输入+输出+余量 <= 窗口），再扣除工具定义估算、封顶 CHAT_HISTORY_BUDGET_CAP。

    预算覆盖"系统提示词 + 工具定义 + 对话历史"三项每轮固定/变动开销：
    工具定义 token 在本函数内先于历史扣除（agent 路径按 registry.get_definitions()
    序列化估算传入，legacy 纯文本路径无工具传 0，未传时按保守常量预留）；
    系统提示词（约 10.6k 字符）与历史由消费方在预算内扣除——AgentMemory.get_messages
    会先减去 system prompt，legacy 路径的 truncate_history_by_tokens 以 system prompt 起算。

    参数:
        provider: Provider 实例（BaseProvider 子类，需提供 get_context_window）
        tool_definitions_tokens: 工具定义的估算 token 数。None 时按保守常量
            _DEFAULT_TOOL_DEFINITIONS_TOKENS 预留；无工具的调用方显式传 0。

    返回:
        历史 token 预算。探测失败/不支持/窗口小到无法支撑对话时，
        回退 CHAT_HISTORY_BUDGET_CAP（与旧版硬编码默认一致，行为不劣于现状）；
        扣除工具定义后低于 _MIN_HISTORY_BUDGET 时按保底值继续并告警。
    """
    # 延迟导入防循环依赖（与 memory.py 引 estimate_tokens 同模式）
    from app.shared.services.llm.providers.base import compute_token_budgets

    try:
        # get_context_window 内部可能调 Ollama 的同步 urllib 探测，
        # 放线程池避免阻塞事件循环（与 generation/migrate 服务同模式）
        context_window = await asyncio.to_thread(provider.get_context_window)
        # 输出预算按窗口自适应（小窗减输出、大窗封顶 8000），输入预算为窗口减输出与余量
        input_budget, _output_budget = compute_token_budgets(int(context_window))
        # 工具定义与系统提示词同属"每轮固定开销"，先于对话历史从输入预算扣除
        tools_tokens = (
            _DEFAULT_TOOL_DEFINITIONS_TOKENS
            if tool_definitions_tokens is None
            else max(0, int(tool_definitions_tokens))
        )
        history_budget = input_budget - tools_tokens
        if history_budget < _MIN_HISTORY_BUDGET:
            # 极端小窗：系统提示词+工具定义已接近或超出窗口。保底继续（多轮对话
            # 至少保留最近几轮），告警提示人工介入；预算推导失败不应阻断对话本身
            logger.warning(
                f"上下文窗口过小：输入预算 {input_budget} 扣除工具定义约 {tools_tokens} token 后仅剩 "
                f"{history_budget}，已按保底 {_MIN_HISTORY_BUDGET} 继续"
                "（系统提示词+工具定义已接近或超出窗口，建议更换更大窗口的模型或精简工具集）"
            )
            history_budget = _MIN_HISTORY_BUDGET
        return min(history_budget, CHAT_HISTORY_BUDGET_CAP)
    except Exception as e:
        # 窗口探测失败（网络/不支持 get_context_window）或窗口 < MIN_CONTEXT_WINDOW
        # （compute_token_budgets 抛 ValueError，视为无法支撑自适应）→ 回退默认
        logger.warning(f"上下文窗口探测失败，聊天历史预算回退默认 {CHAT_HISTORY_BUDGET_CAP}: {e}")
        return CHAT_HISTORY_BUDGET_CAP


def _summarize_validation_error(e: ValidationError) -> str:
    """把 pydantic 严格校验失败压缩为单行首要字段级原因。

    概览的 parse_errors 每文件只留一行摘要；pydantic 原始报错是多行大段文本
    （含 "2 validation errors for TableSchemaFile" 头 + 逐条缩进详情），
    直接透传会挤爆概览。只取第一条错误的字段路径 + 消息（如
    "source.mode: Field required"），保留原始英文措辞——与校验中止时
    loading_errors 里透出的原文一致，agent 可跨信号对照定位。

    参数:
        e: model_validate 抛出的 ValidationError

    返回:
        单行错误摘要，如 "严格校验失败: source.mode: Field required"
    """
    errors = e.errors()
    if not errors:  # 理论不可达，防御性兜底
        return "严格校验失败: 配置结构不符合模型要求"
    first = errors[0]
    loc = ".".join(str(part) for part in first.get("loc", ()))
    msg = str(first.get("msg", "") or "校验失败")
    reason = f"{loc}: {msg}" if loc else msg
    return f"严格校验失败: {reason}"


def get_project_overview(project_path: str) -> dict[str, Any]:
    """
    @methoddesc 扫描项目目录，生成项目概览信息

    读取项目下的 schemas/ 和 constraints/ 目录中的 YAML 文件，
    汇总所有表结构、字段信息以及约束规则，供 AI 上下文使用。

    本函数以 manifest 为权威来源：磁盘上存在但未登记到 manifest 的孤儿文件
    会标注 unlisted=True，避免 AI 视角与用户资源树视角产生偏差（前者纯 glob，
    后者走 manifest）。

    解析失败的文件不静默跳过：记入 parse_errors（文件相对路径 + 错误摘要），
    让 read_project 的调用方（AI agent）一眼看到"哪些文件坏了"，再用
    read_config_file 工具读原文定位问题。

    除 YAML 语法错误外，每类配置文件还会用运行时同款的严格 File 模型
    （schema→TableSchemaFile、constraint→ConstraintFile、regex→RegexNodeFile、
    transform→TransformFile）追加一次 model_validate——缺必填字段（如
    source.mode）这类"YAML 合法但结构损坏"的文件会被严格解析器拒绝、
    导致校验中止，宽松读取却看不出来；概览必须同口径透出，agent 才能
    识别并主动修复（对应 UPDATE_* 动作）。

    参数:
        project_path: 项目根目录路径

    返回:
        项目概览字典，包含 schemas/constraints/transforms/regex_nodes/settings
        与 parse_errors（解析/严格校验失败文件清单，每项 {"path": str, "error": str}）
    """
    overview: dict[str, Any] = {
        "schemas": [],
        "constraints": [],
        "transforms": [],
        "regex_nodes": [],
        "settings": {},
        "parse_errors": [],
    }

    if not project_path:
        return overview

    # 解析失败文件的记录器：同一文件多处读取失败只记一次（如 manifest 的
    # schemas 白名单与 settings 两段读取），错误摘要截断防止超长 traceback 撑爆概览
    recorded_error_paths: set[str] = set()

    def record_parse_error(rel_path: str, error: Exception | str) -> None:
        """把解析/读取/严格校验失败的文件记入 overview["parse_errors"]（去重 + 摘要截断）。"""
        if rel_path in recorded_error_paths:
            return
        recorded_error_paths.add(rel_path)
        if isinstance(error, str):
            summary = error.strip() or "配置文件解析失败"
        else:
            summary = str(error).strip() or type(error).__name__
        if len(summary) > 200:
            summary = summary[:200] + "..."
        overview["parse_errors"].append({"path": rel_path, "error": summary})

    def check_strict_model(rel_path: str, data: Any, model: type[BaseModel]) -> None:
        """用运行时同款严格 File 模型校验已宽松读出的数据，失败记入 parse_errors。

        与各 reader（load_schema 等）的 model_validate 同一模型：这里失败 ≈
        校验引擎加载该文件时也会失败（校验中止的根因），agent 据此可主动修复。
        只记错误不打断宽松提取——文件仍进对应资源列表（名称/列等宽松可见）。
        """
        try:
            model.model_validate(data)
        except ValidationError as e:
            logger.warning(f"配置文件严格校验失败 {rel_path}: {e.errors()[:1]}")
            record_parse_error(rel_path, _summarize_validation_error(e))

    project_root = Path(project_path)

    # 读取 manifest 的 schemas 白名单，用于标注孤儿文件
    listed_schema_paths: set[str] = set()
    manifest_path = project_root / "project.precis.yaml"
    if manifest_path.exists():
        try:
            with open(manifest_path, encoding="utf-8") as f:
                manifest_data = yaml.safe_load(f) or {}
            for ref in manifest_data.get("schemas", []) or []:
                p = ref.get("path") if isinstance(ref, dict) else None
                if isinstance(p, str) and p:
                    listed_schema_paths.add(p.replace("\\", "/").lower())
        except Exception as e:
            logger.warning(f"读取 manifest schemas 失败 {manifest_path}: {e}")
            record_parse_error("project.precis.yaml", e)

    schemas_dir = project_root / "schemas"
    if schemas_dir.exists():
        for schema_file in schemas_dir.glob("*.yaml"):
            try:
                with open(schema_file, encoding="utf-8") as f:
                    schema_data = yaml.safe_load(f) or {}

                # 严格校验（宽松提取前先记）：缺 source.mode 等字段级损坏在此暴露
                check_strict_model(f"schemas/{schema_file.name}", schema_data, TableSchemaFile)

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
                    # 标注该 schema 是否登记在 manifest 中，孤儿文件 unlisted=True
                    rel_path = f"schemas/{schema_file.name}".replace("\\", "/").lower()
                    overview["schemas"].append(
                        {
                            "id": table_id,
                            "name": table_name,
                            "columns": column_list,
                            "unlisted": rel_path not in listed_schema_paths,
                            "path": f"schemas/{schema_file.name}",
                        }
                    )

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
                            # §2.13: 读取磁盘真实 enabled（无字段默认 true，与运行时语义一致）——
                            # 原硬编码 True 使 AI 对已禁用约束误判"在生效"
                            "enabled": ic.get("enabled", True),
                            "table_id": table_id,
                            "table_name": table_name,
                            "column_id": col_id,
                            "column_name": col_name,
                            "params": params,
                            "is_inline": True,
                        }
                    )
            except Exception as e:
                logger.warning(f"读取 schema 文件失败 {schema_file}: {e}")
                record_parse_error(f"schemas/{schema_file.name}", e)

    constraints_dir = project_root / "constraints"
    if constraints_dir.exists():
        for constraint_file in constraints_dir.glob("*.constraint.yaml"):
            try:
                with open(constraint_file, encoding="utf-8") as f:
                    constraint_data = yaml.safe_load(f) or {}

                # 严格校验：未知约束类型/缺 id 等字段级损坏在此暴露
                check_strict_model(f"constraints/{constraint_file.name}", constraint_data, ConstraintFile)

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
                record_parse_error(f"constraints/{constraint_file.name}", e)

    # 扫描 Regex 节点
    for dirname in ("regex_nodes", "regex"):
        regex_dir = project_root / dirname
        if regex_dir.exists():
            for regex_file in regex_dir.glob("*.yaml"):
                try:
                    with open(regex_file, encoding="utf-8") as f:
                        regex_data = yaml.safe_load(f) or {}

                    # 严格校验：pattern/uses_pattern 二选一等结构损坏在此暴露
                    check_strict_model(f"{dirname}/{regex_file.name}", regex_data, RegexNodeFile)

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
                    logger.warning(f"读取 regex 文件失败 {regex_file}: {e}")
                    record_parse_error(f"{dirname}/{regex_file.name}", e)

    # 扫描 Transform 节点
    transforms_dir = project_root / "transforms"
    if transforms_dir.exists():
        for transform_file in transforms_dir.glob("*.yaml"):
            try:
                with open(transform_file, encoding="utf-8") as f:
                    transform_data = yaml.safe_load(f) or {}

                # 严格校验：未知转换类型/缺 id 等字段级损坏在此暴露
                check_strict_model(f"transforms/{transform_file.name}", transform_data, TransformFile)

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
                logger.warning(f"读取 transform 文件失败 {transform_file}: {e}")
                record_parse_error(f"transforms/{transform_file.name}", e)

    # 读取项目设置
    manifest_path = project_root / "project.precis.yaml"
    if manifest_path.exists():
        try:
            with open(manifest_path, encoding="utf-8") as f:
                manifest_data = yaml.safe_load(f) or {}

            overview["settings"] = manifest_data.get("settings", {})
        except Exception as e:
            logger.warning(f"读取 manifest 设置失败 {manifest_path}: {e}")
            record_parse_error("project.precis.yaml", e)

    return overview
