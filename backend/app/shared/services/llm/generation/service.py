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
"""@fileoverview AI 配置生成服务（编排层）

功能概述:
- 基于 AI 分析数据文件自动生成 Precis 项目配置
- 支持生成 Schema、Constraint、Regex Node 等多种配置
- 支持进度回调和取消操作
- Agent 模式：多轮自迭代优化 + 大数据分块 + 旧脚本迁移

架构设计（2026-09 职责拆分，本模块仅保留编排）:
- errors.py: 生成链路共享异常（GenerationParseError / CancelledError）
- response_parser.py: LLM 响应 JSON 提取与解析（字符串感知配平）
- profiler.py: 数据文件画像 + ProfilingOptions（采样与列信息提取）
- existing_config.py: 既有项目配置加载（keep_existing 合并基线）
- agent_wiring.py: Agent 工具注册表与系统/任务提示词构建
- 本模块: ConfigGenerationService 编排单次生成（generate）与
  Agent 多轮生成（generate_with_agent），以及供子类（ConfigMigrationService）
  与 Agent 工具复用的受保护方法（scope 生成 / LLM 精修 / 配置构建）

输入示例:
    service = ConfigGenerationService(provider_id="openai")
    result = await service.generate_with_agent(
        file_paths=["data/users.xlsx", "data/orders.xlsx"],
        project_name="电商数据校验",
        project_id="ecommerce",
        max_iterations=2,
    )

输出示例:
    {
        "success": True,
        "manifest": {...},
        "schemas": {...},
        "constraints": {...},
        "regex_nodes": {...},
        "yaml_preview": "...",
        "iterations": 2,
        "metrics": {"total_rules": 10, "passed_rules": 9, "failed_rules": 1},
        "warnings": []
    }
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import yaml

from ..config import loader
from ..providers import ChatMessage, ChatRequest, create
from .agent_wiring import build_agent_system_prompt, build_agent_task_message, create_agent_registry
from .config_builder import build_config
from .errors import CancelledError, GenerationParseError
from .existing_config import load_existing_config
from .profiler import ProfilingOptions, filter_profiling, format_profiling_for_agent, profile_files
from .prompt_builder import build_prompt
from .response_parser import find_json_object_end, parse_llm_response, try_extract_json_object

if TYPE_CHECKING:
    from app.shared.services.ai.agent.types import ToolResult

    from ..providers.base import BaseProvider

logger = logging.getLogger(__name__)

# 历史导出名兼容：测试直接从本模块导入 _find_json_object_end（2026-09 拆分前为本模块函数）
_find_json_object_end = find_json_object_end

__all__ = [
    "ConfigGenerationService",
    "GenerationOptions",
    "ProfilingOptions",
    "CancelledError",
    "GenerationParseError",
]


@dataclass
class GenerationOptions:
    """生成选项"""

    generate_schemas: bool = True
    generate_constraints: bool = True
    generate_regex_nodes: bool = True
    keep_existing: bool = True


class ConfigGenerationService:
    """
    @classdesc AI 配置生成服务（编排层）

    基于 AI 分析数据文件自动生成 Precis 项目配置。
    支持单次快速生成和 Agent 多轮优化生成两种模式；
    数据画像、响应解析、Agent 装配等具体能力委托给同包子模块。
    """

    def __init__(self, provider_id: str | None = None):
        """
        @methoddesc 初始化配置生成服务

        参数:
            provider_id: 指定 Provider ID，None 则使用默认
        """
        self.provider_id = provider_id
        self._provider: BaseProvider | None = None
        self._cancelled = False

        # Agent 模式运行时状态
        self._file_paths: list[str] = []
        self._project_name: str = ""
        self._project_id: str = ""
        self._config_path: str | None = None
        self._profiling_options: ProfilingOptions = ProfilingOptions()
        self._generation_options: GenerationOptions = GenerationOptions()
        self._profiling_data: list[dict] = []
        self._existing_config: dict[str, Any] | None = None
        self._last_metrics: dict[str, Any] | None = None
        self._current_plan: list[dict[str, Any]] | None = None

    def _get_provider(self) -> BaseProvider:
        """
        @methoddesc 获取 Provider 实例

        懒加载：首次调用时从用户级 AI 配置中查找并创建 Provider 实例。
        优先使用显式指定的 provider_id，其次 defaults.generate / defaults.chat。
        如果默认指向的 Provider 不存在，则回退到第一个已配置 Provider。
        """
        if self._provider is None:
            config = loader.load()
            pid = self.provider_id

            if not pid:
                pid = config.defaults.get("generate") or config.defaults.get("chat")

            provider_cfg = next((p for p in config.providers if p.id == pid), None) if pid else None
            if provider_cfg is None and config.providers:
                provider_cfg = config.providers[0]
                pid = provider_cfg.id

            if not provider_cfg:
                raise ValueError("No provider configured")

            self._provider = create(provider_cfg)
        return self._provider

    async def generate(
        self,
        file_paths: list[str],
        project_name: str,
        project_id: str,
        config_path: str | None = None,
        profiling_options: ProfilingOptions | None = None,
        generation_options: GenerationOptions | None = None,
        progress_callback: Callable[[str, float], None] | None = None,
    ) -> dict[str, Any]:
        """
        @methoddesc 单次快速生成配置

        完整流程：数据画像 -> 构建 Prompt -> 调用 LLM -> 解析响应 -> 构建最终配置。
        """
        self._setup_run(
            file_paths=file_paths,
            project_name=project_name,
            project_id=project_id,
            config_path=config_path,
            profiling_options=profiling_options,
            generation_options=generation_options,
        )

        # 阶段 1: 数据画像
        self._check_cancelled(progress_callback, "profiling", 10)
        self._profiling_data = await self._profile_files(file_paths, self._profiling_options)

        # 阶段 2: 构建提示词
        self._check_cancelled(progress_callback, "building_prompt", 20)
        prompt, prompt_warnings = build_prompt(self._profiling_data, project_name)

        # 阶段 3: 调用 LLM
        self._check_cancelled(progress_callback, "generating", 40)
        provider = self._get_provider()
        chat_req = ChatRequest(
            messages=[
                ChatMessage(role="system", content="你是一个数据治理专家，擅长分析数据文件并生成数据验证配置。"),
                ChatMessage(role="user", content=prompt),
            ],
            temperature=0.3,
        )
        response = await provider.chat(chat_req)

        # 阶段 4: 解析响应
        self._check_cancelled(progress_callback, "parsing", 80)
        result = self._parse_response(response.content or "")

        # 阶段 5: 构建最终配置
        self._check_cancelled(progress_callback, "finalizing", 95)
        config = self._build_config_from_llm_result(result)
        config["warnings"] = config.get("warnings", []) + prompt_warnings

        self._notify_progress(progress_callback, "completed", 100)
        return config

    async def generate_with_agent(
        self,
        file_paths: list[str],
        project_name: str,
        project_id: str,
        config_path: str | None = None,
        profiling_options: ProfilingOptions | None = None,
        generation_options: GenerationOptions | None = None,
        max_iterations: int = 2,
        validation_sample_size: int = 1000,
        auto_chunking: bool = True,
        chunk_max_columns: int = 20,
        chunk_max_files: int = 5,
        progress_callback: Callable[[str, float, dict[str, Any] | None], None] | None = None,
        checkpoint_callback: Callable[[dict[str, Any]], None] | None = None,
        initial_checkpoint: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        @methoddesc Agent 多轮优化生成配置

        流程：数据画像 -> Agent 规划/生成 -> 校验 -> 精修 -> 输出最终配置。
        """
        from app.shared.services.ai.agent import AgentExecutor

        self._setup_run(
            file_paths=file_paths,
            project_name=project_name,
            project_id=project_id,
            config_path=config_path,
            profiling_options=profiling_options,
            generation_options=generation_options,
        )

        # 阶段 1: 数据画像
        self._check_cancelled(progress_callback, "profiling", 5)
        self._profiling_data = await self._profile_files(file_paths, self._profiling_options)

        # 阶段 2: 加载现有配置
        self._check_cancelled(progress_callback, "loading_existing", 10)
        if self._generation_options.keep_existing and config_path:
            self._existing_config = self._load_existing_config(config_path)

        # 阶段 3: Agent 执行
        self._check_cancelled(progress_callback, "agent_planning", 15)

        # 注册工具（Agent 装配细节见 agent_wiring.py）
        registry = create_agent_registry(
            service=self,
            validation_sample_size=validation_sample_size,
            chunk_max_columns=chunk_max_columns,
            chunk_max_files=chunk_max_files,
        )

        provider = self._get_provider()
        # get_context_window 内部可能调用 Ollama 的同步 urllib 探测，放到线程池避免阻塞事件循环
        context_window = await asyncio.to_thread(provider.get_context_window)
        max_tokens = max(context_window - 8000, 4096)
        executor = AgentExecutor(
            provider=provider,
            registry=registry,
            system_prompt=build_agent_system_prompt(),
            max_iterations=max_iterations,
            max_tokens=max_tokens,
            progress_callback=lambda stage, progress, extra: self._agent_progress_callback(
                progress_callback, stage, progress, extra
            ),
            checkpoint_callback=checkpoint_callback,
            cancelled_callback=lambda: self._cancelled,
            on_tool_result=lambda tr: self._on_agent_tool_result(tr),
        )

        task_message = build_agent_task_message(
            profiling_data=self._profiling_data,
            project_name=self._project_name,
            project_id=self._project_id,
            keep_existing=self._generation_options.keep_existing,
            auto_chunking=auto_chunking,
            chunk_max_columns=chunk_max_columns,
            chunk_max_files=chunk_max_files,
        )

        agent_result = await executor.run(task_message, initial_checkpoint=initial_checkpoint)

        if not agent_result.success:
            return {
                "success": False,
                "error": agent_result.error,
                "yaml_preview": "",
                "manifest": None,
                "schemas": {},
                "constraints": {},
                "regex_nodes": {},
                "warnings": [],
                "iterations": agent_result.iterations,
                "metrics": agent_result.metrics.to_dict() if agent_result.metrics else None,
            }

        # 阶段 4: 构建最终返回
        config = agent_result.config or {}
        if not config:
            # 尝试从最后一轮 content 中解析
            config = self._try_parse_config_from_content(agent_result.content) or {}

        if not config.get("schemas") and not config.get("constraints"):
            return {
                "success": False,
                "error": "Agent 未生成有效配置（缺少 schemas/constraints）",
                "yaml_preview": "",
                "manifest": None,
                "schemas": {},
                "constraints": {},
                "regex_nodes": {},
                "warnings": [],
                "iterations": agent_result.iterations,
                "metrics": agent_result.metrics.to_dict() if agent_result.metrics else None,
            }

        # 补充 YAML 预览和统一字段
        if "yaml_preview" not in config:
            preview = {
                "manifest": config.get("manifest", {}),
                "schemas": config.get("schemas", {}),
                "constraints": config.get("constraints", {}),
                "regex_nodes": config.get("regex_nodes", {}),
            }
            config["yaml_preview"] = yaml.safe_dump(preview, sort_keys=False, allow_unicode=True)

        config["success"] = True
        config["iterations"] = agent_result.iterations
        config["metrics"] = agent_result.metrics.to_dict() if agent_result.metrics else self._last_metrics
        config["warnings"] = config.get("warnings", [])

        self._notify_progress(progress_callback, "completed", 100)
        return config

    def _setup_run(
        self,
        file_paths: list[str],
        project_name: str,
        project_id: str,
        config_path: str | None,
        profiling_options: ProfilingOptions | None,
        generation_options: GenerationOptions | None,
    ) -> None:
        """设置运行时状态。"""
        self._file_paths = file_paths
        self._project_name = project_name
        self._project_id = project_id
        self._config_path = config_path
        self._profiling_options = profiling_options or ProfilingOptions()
        self._generation_options = generation_options or GenerationOptions()
        self._profiling_data = []
        self._existing_config = None
        self._cancelled = False
        self._current_plan = None

    def _check_cancelled(
        self,
        progress_callback: Callable[..., None] | None,
        stage: str,
        progress: float,
    ) -> None:
        """检查取消状态并上报进度。"""
        if self._cancelled:
            raise CancelledError("Generation cancelled")
        self._notify_progress(progress_callback, stage, progress)

    def _notify_progress(
        self,
        progress_callback: Callable[..., None] | None,
        stage: str,
        progress: float,
    ) -> None:
        """触发进度回调。"""
        if progress_callback:
            progress_callback(stage, progress)

    def _agent_progress_callback(
        self,
        progress_callback: Callable[[str, float, dict[str, Any] | None], None] | None,
        stage: str,
        progress: float,
        extra: dict[str, Any] | None,
    ) -> None:
        """Agent 进度映射到 0.15-0.95 区间，并透传 current_plan。"""
        mapped = 15 + progress * 80
        merged_extra = dict(extra or {})
        if self._current_plan is not None:
            merged_extra["current_plan"] = self._current_plan
        if progress_callback:
            progress_callback(stage, mapped / 100.0, merged_extra)

    def _on_agent_tool_result(self, tr: ToolResult) -> None:
        """从工具结果中提取 metrics 和 current_plan。"""
        from app.shared.services.ai.agent.types import AgentMetrics, ToolResult

        if not isinstance(tr, ToolResult):
            return
        if tr.name == "validate_config" and isinstance(tr.observation, dict):
            obs = tr.observation
            metrics = AgentMetrics(
                total_rules=obs.get("total_rules", 0),
                passed_rules=obs.get("passed", 0),
                failed_rules=obs.get("failed", 0),
                issues=obs.get("issues", []),
            )
            # 暂时保存到 service 实例，后续可以传入 result
            self._last_metrics = metrics.to_dict()
        elif tr.name == "plan_chunks" and isinstance(tr.observation, dict):
            plan = tr.observation.get("plan")
            if isinstance(plan, dict):
                self._current_plan = [plan]
            elif isinstance(plan, list):
                self._current_plan = plan

    async def _generate_config_for_scope(
        self,
        file_paths: list[str],
        instructions: str,
        previous_config: dict[str, Any] | None,
        scope: dict[str, Any],
    ) -> dict[str, Any]:
        """
        @methoddesc 为指定 scope 生成配置（Agent 工具内部使用）

        参数:
            file_paths: 数据文件路径
            instructions: 生成指令
            previous_config: 上一轮配置
            scope: 生成范围

        返回:
            完整配置字典
        """
        # 如果 scope 指定了 table_names/columns，做局部画像
        profiling_data = self._profiling_data
        table_names = scope.get("table_names")
        columns_filter = scope.get("columns")
        if table_names or columns_filter:
            profiling_data = filter_profiling(profiling_data, table_names, columns_filter)

        # 如果没画像过，临时画像
        if not profiling_data:
            profiling_data = await self._profile_files(file_paths, self._profiling_options)

        extra_context: list[str] = []
        if instructions:
            extra_context.append(f"生成指令: {instructions}")
        if previous_config:
            extra_context.append("上一轮配置摘要:\n" + self._summarize_config(previous_config))

        prompt, prompt_warnings = build_prompt(
            profiling_data,
            self._project_name,
            extra_context=extra_context,
        )

        provider = self._get_provider()
        chat_req = ChatRequest(
            messages=[
                ChatMessage(role="system", content="你是一个数据治理专家，擅长分析数据文件并生成数据验证配置。"),
                ChatMessage(role="user", content=prompt),
            ],
            temperature=0.3,
        )
        response = await provider.chat(chat_req)
        result = self._parse_response(response.content or "")
        config = self._build_config_from_llm_result(result)
        config["warnings"] = config.get("warnings", []) + prompt_warnings
        return config

    async def _refine_config_with_llm(
        self,
        config: dict[str, Any],
        issues: list[dict[str, Any]],
        strategy: str,
    ) -> dict[str, Any]:
        """
        @methoddesc 使用 LLM 精修配置

        参数:
            config: 当前配置
            issues: 校验问题
            strategy: 修正策略

        返回:
            {"config": {...}, "removed_rules": [...], "modified_rules": [...], "warnings": [...]}
        """
        issues_text = yaml.safe_dump(issues, sort_keys=False, allow_unicode=True)
        config_text = yaml.safe_dump(
            {
                "schemas": config.get("schemas", {}),
                "constraints": config.get("constraints", {}),
                "regex_nodes": config.get("regex_nodes", {}),
            },
            sort_keys=False,
            allow_unicode=True,
        )

        prompt = f"""根据以下校验问题修正数据验证配置。

## 修正策略
{strategy}

## 当前配置
{config_text}

## 校验问题
{issues_text}

## 要求
- 移除明显错误的规则
- 放宽过于严格的规则参数
- 保留合理的规则
- 直接返回修正后的完整 JSON 配置，包含 schemas、constraints、regex_nodes
"""

        provider = self._get_provider()
        chat_req = ChatRequest(
            messages=[
                ChatMessage(role="system", content="你是一个数据治理专家，擅长修正数据验证配置。"),
                ChatMessage(role="user", content=prompt),
            ],
            temperature=0.2,
        )
        response = await provider.chat(chat_req)
        result = self._parse_response(response.content or "")
        refined_config = self._build_config_from_llm_result(result)

        # 对比找出 removed/modified
        original_ids = set(config.get("constraints", {}).keys()) | set(config.get("regex_nodes", {}).keys())
        refined_ids = set(refined_config.get("constraints", {}).keys()) | set(
            refined_config.get("regex_nodes", {}).keys()
        )
        removed = list(original_ids - refined_ids)
        modified = list(original_ids & refined_ids)

        return {
            "config": refined_config,
            "removed_rules": removed,
            "modified_rules": modified,
            "warnings": refined_config.get("warnings", []),
        }

    def _summarize_config(self, config: dict[str, Any]) -> str:
        """生成配置摘要（用于 prompt）。"""
        schemas = config.get("schemas", {})
        constraints = config.get("constraints", {})
        regex_nodes = config.get("regex_nodes", {})
        lines = [
            f"schemas: {len(schemas)}",
            f"constraints: {len(constraints)}",
            f"regex_nodes: {len(regex_nodes)}",
        ]
        for cid, cdef in list(constraints.items())[:10]:
            lines.append(f"- {cid}: {cdef.get('type')} -> {cdef.get('refs', {})}")
        return "\n".join(lines)

    def _build_config_from_llm_result(self, result: dict[str, Any]) -> dict[str, Any]:
        """使用 build_config 从 LLM 结果构建配置。"""
        return build_config(
            project_id=self._project_id,
            project_name=self._project_name,
            config_path=self._config_path,
            profiling_data=self._profiling_data,
            llm_result=result,
            options=self._generation_options,
            existing_config=self._existing_config,
        )

    # ---- 以下为委托方法：实现已拆分至同包子模块，保留方法签名以维持
    # ---- 子类（ConfigMigrationService）、Agent 工具与既有测试的调用面不变。

    def _parse_response(self, content: str) -> dict:
        """解析 LLM 响应文本（委托 response_parser.parse_llm_response）。"""
        return parse_llm_response(content)

    def _try_parse_config_from_content(self, content: str | None) -> dict[str, Any] | None:
        """从文本解析配置（JSON 提取委托 response_parser，构建走 build_config）。"""
        parsed = try_extract_json_object(content)
        if parsed is None:
            return None
        return self._build_config_from_llm_result(parsed)

    async def _profile_files(self, file_paths: list[str], options: ProfilingOptions) -> list[dict]:
        """分析数据文件获取画像（委托 profiler.profile_files，注入取消探测）。"""
        return await profile_files(file_paths, options, lambda: self._cancelled)

    def _format_profiling_for_agent(self) -> str:
        """画像数据格式化（委托 profiler.format_profiling_for_agent）。"""
        return format_profiling_for_agent(self._profiling_data)

    def _load_existing_config(self, config_path: str) -> dict[str, Any] | None:
        """加载既有配置（委托 existing_config.load_existing_config）。"""
        return load_existing_config(config_path)

    def cancel(self) -> None:
        """
        @methoddesc 标记生成任务为已取消状态

        异步任务会在合适的检查点检测到取消标记并抛出 CancelledError。
        """
        self._cancelled = True
