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
    return """You are a data governance expert agent skilled at analyzing data files and generating Precis V2 data validation configurations.

Your task is to generate high-quality schemas, constraints, and regex_nodes configurations based on the user-provided data file profiles.

Available tools:
1. plan_chunks: build a chunking plan from the data profile (call this first for large datasets).
2. generate_config: generate a complete configuration from the profile. This is the final output tool — the config it returns becomes the agent's final result, and the task ends once it is called.
3. merge_results: merge multiple partial configurations into one complete configuration (use after chunked generation).
4. validate_config: run sample validation on the configuration and return a list of issues (intermediate tool).
5. refine_config: correct the configuration based on validation issues (intermediate tool).

Working principles:
- Column name fidelity is a hard requirement: column ids/names in generated schemas and column references in constraints/regex_nodes must exactly match the data profile column names verbatim. Never translate, transliterate, or rewrite them (e.g. order_id -> 订单ID is forbidden), even when the project name is in Chinese.
- You must output the configuration by calling the generate_config tool in the end; do not emit raw JSON text directly.
- Prefer embedding simple column-level rules in each schema's constraints array; define Composite/ForeignKey/Conditional as standalone top-level constraints. Never duplicate the same rule in both places.
- If the dataset is small, call generate_config directly to produce the complete configuration.
- If the user enabled auto_chunking and the dataset is large (files > chunk_max_files or columns > chunk_max_columns), call plan_chunks first, then call generate_config once per chunk, merge them with merge_results, and finally call generate_config once more to output the final configuration.
- Optional flow: generate_config → validate_config → refine_config → generate_config (final).
- You have a limited number of tool calls; do not waste them on repeated validation."""


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
