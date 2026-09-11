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
"""@fileoverview Agent 模式装配（工具注册表 + 提示词构建）

把 ConfigGenerationService 中与 AgentExecutor 装配相关的纯构建逻辑
抽出为无状态函数：工具注册表创建、系统提示词与任务消息构建。
注册表中的 generate/refine 工具持有 service 实例引用（工具内部回调
service 的生成/精修能力），故 create_agent_registry 以 service 为参数。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .profiler import format_profiling_for_agent

if TYPE_CHECKING:
    from app.shared.services.ai.agent.tool_registry import ToolRegistry

    from .service import ConfigGenerationService


def create_agent_registry(
    service: ConfigGenerationService,
    validation_sample_size: int,
    chunk_max_columns: int,
    chunk_max_files: int,
) -> ToolRegistry:
    """创建 Agent 工具注册表。

    参数:
        service: 配置生成服务实例（generate/refine 工具的执行宿主）
        validation_sample_size: validate_config 工具的抽样行数
        chunk_max_columns: 分块列数上限（plan_chunks 工具）
        chunk_max_files: 分块文件数上限（plan_chunks 工具）

    返回:
        已注册全部五个工具的 ToolRegistry
    """
    from app.shared.services.ai.agent.tool_registry import ToolRegistry
    from app.shared.services.ai.agent.tools import (
        ConfigGenerateTool,
        ConfigRefineTool,
        ConfigValidateTool,
        MergeResultsTool,
        PlanChunksTool,
    )

    registry = ToolRegistry()

    # 工具注册统一走 register_tool（name/description/parameters/handler 自动提取）
    registry.register_tool(
        PlanChunksTool(
            profiling_data=service._profiling_data,
            file_paths=service._file_paths,
            chunk_max_columns=chunk_max_columns,
            chunk_max_files=chunk_max_files,
        )
    )
    registry.register_tool(MergeResultsTool())
    # generate/refine 工具持有 service 引用（工具内部回调 service 的生成/精修能力）
    registry.register_tool(ConfigGenerateTool(service))
    registry.register_tool(
        ConfigValidateTool(
            file_paths=service._file_paths,
            profiling_data=service._profiling_data,
            sample_size=validation_sample_size,
        )
    )
    registry.register_tool(ConfigRefineTool(service))

    return registry


def build_agent_system_prompt() -> str:
    """构建 Agent 系统提示词。"""
    return """你是一个数据治理专家 Agent，擅长分析数据文件并生成 Precis V2 数据验证配置。

你的任务是根据用户提供的数据文件画像，生成高质量的 schemas、constraints、regex_nodes 配置。

可用工具：
1. plan_chunks: 根据数据画像生成分块计划（大数据量时先调用）。
2. generate_config: 根据画像生成完整配置。这是最终输出工具，工具返回的 config 会被作为 Agent 最终结果，调用后任务即结束。
3. merge_results: 合并多个局部配置为一个完整配置（分块生成后使用）。
4. validate_config: 对配置做抽样校验，返回问题列表（中间工具）。
5. refine_config: 根据校验问题修正配置（中间工具）。

工作原则：
- 最终必须通过调用 generate_config 工具输出配置，不要直接输出 JSON 文本。
- 如果数据量小，直接调用 generate_config 生成完整配置。
- 如果用户开启了 auto_chunking 且数据量大（文件数 > chunk_max_files 或列数 > chunk_max_columns），先调用 plan_chunks，然后按 chunk 多次调用 generate_config，最后用 merge_results 合并，再调用一次 generate_config 输出最终配置。
- 可选流程：generate_config → validate_config → refine_config → generate_config（最终）。
- 你最多只能调用有限次工具，不要把大量时间浪费在反复校验上。"""


def build_agent_task_message(
    profiling_data: list[dict],
    project_name: str,
    project_id: str,
    keep_existing: bool,
    auto_chunking: bool,
    chunk_max_columns: int,
    chunk_max_files: int,
) -> str:
    """构建 Agent 任务消息。

    参数:
        profiling_data: 数据画像结果
        project_name: 项目显示名
        project_id: 项目标识符
        keep_existing: 是否保留既有配置
        auto_chunking: 是否开启自动分块
        chunk_max_columns: 分块列数上限
        chunk_max_files: 分块文件数上限

    返回:
        拼装完成的任务消息文本
    """
    parts = [
        f"为项目 '{project_name}' (id={project_id}) 生成数据验证配置。",
        "",
        "## 数据画像",
        format_profiling_for_agent(profiling_data),
        "",
        "## 要求",
        "- 生成 schemas、constraints、regex_nodes",
        f"- keep_existing={'true' if keep_existing else 'false'}",
        f"- auto_chunking={'true' if auto_chunking else 'false'}",
    ]
    if auto_chunking:
        parts.extend(
            [
                f"- chunk_max_columns={chunk_max_columns}",
                f"- chunk_max_files={chunk_max_files}",
            ]
        )
    parts.extend(
        [
            "- 工作流建议：直接调用 generate_config 生成完整配置；如果希望更可靠，可以生成后调用 validate_config 校验，再调用 refine_config 修正，最后再次调用 generate_config 输出最终配置。",
            "- 最终必须调用 generate_config 工具，其返回的 config 即为最终结果。",
        ]
    )
    return "\n".join(parts)
