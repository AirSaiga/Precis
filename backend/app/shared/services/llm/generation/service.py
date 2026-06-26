"""@fileoverview AI 配置生成服务

功能概述:
- 基于 AI 分析数据文件自动生成 Precis 项目配置
- 支持生成 Schema、Constraint、Regex Node 等多种配置
- 数据画像：采样数据特征并生成统计摘要
- 支持进度回调和取消操作
- 新增 Agent 模式：多轮自迭代优化 + 大数据分块 + 旧脚本迁移

架构设计:
- 与 Provider 架构联动：通过 loader 读取配置并创建 Provider 实例
- 分阶段生成：数据画像 -> Prompt 构建 -> AI 调用 -> 结果解析 -> 配置保存
- Agent 模式：AgentExecutor + ToolRegistry + AgentMemory 实现规划-执行-观察循环
- 错误处理：GenerationParseError、CancelledError 等自定义异常

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
import json
import logging
import os
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import yaml

from ..config import loader
from ..providers import ChatMessage, ChatRequest, create
from .config_builder import build_config
from .prompt_builder import build_prompt

logger = logging.getLogger(__name__)


@dataclass
class ProfilingOptions:
    """数据画像选项"""

    sample_rows: int = 100
    sample_values_per_column: int = 100
    max_files: int = 50
    max_cell_chars: int = 500


@dataclass
class GenerationOptions:
    """生成选项"""

    generate_schemas: bool = True
    generate_constraints: bool = True
    generate_regex_nodes: bool = True
    keep_existing: bool = True


class GenerationParseError(Exception):
    """LLM 响应解析失败"""

    def __init__(self, message: str, raw_content: str = ""):
        super().__init__(message)
        self.raw_content = raw_content


class CancelledError(Exception):
    """生成被取消"""

    pass


class ConfigGenerationService:
    """
    @classdesc AI 配置生成服务

    基于 AI 分析数据文件自动生成 Precis 项目配置。
    支持单次快速生成和 Agent 多轮优化生成两种模式。
    """

    def __init__(self, provider_id: str | None = None):
        """
        @methoddesc 初始化配置生成服务

        参数:
            provider_id: 指定 Provider ID，None 则使用默认
        """
        self.provider_id = provider_id
        self._provider = None
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

    def _get_provider(self):
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
        result = self._parse_response(response.content)

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

        # 注册工具
        registry = self._create_agent_registry(
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
            system_prompt=self._build_agent_system_prompt(),
            max_iterations=max_iterations,
            max_tokens=max_tokens,
            progress_callback=lambda stage, progress, extra: self._agent_progress_callback(
                progress_callback, stage, progress, extra
            ),
            checkpoint_callback=checkpoint_callback,
            cancelled_callback=lambda: self._cancelled,
            on_tool_result=lambda tr: self._on_agent_tool_result(tr),
        )

        task_message = self._build_agent_task_message(
            auto_chunking=auto_chunking,
            chunk_max_columns=chunk_max_columns,
            chunk_max_files=chunk_max_files,
        )

        agent_result = await executor.run(task_message)

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

    def _on_agent_tool_result(self, tr) -> None:
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

    def _create_agent_registry(
        self,
        validation_sample_size: int,
        chunk_max_columns: int,
        chunk_max_files: int,
    ):
        """创建 Agent 工具注册表。"""
        from app.shared.services.ai.agent.tool_registry import ToolRegistry
        from app.shared.services.ai.agent.tools import (
            ConfigGenerateTool,
            ConfigRefineTool,
            ConfigValidateTool,
            MergeResultsTool,
            PlanChunksTool,
        )

        registry = ToolRegistry()

        plan_tool = PlanChunksTool(
            profiling_data=self._profiling_data,
            file_paths=self._file_paths,
            chunk_max_columns=chunk_max_columns,
            chunk_max_files=chunk_max_files,
        )
        registry.register(
            name=plan_tool.NAME,
            description=plan_tool.get_definition()["function"]["description"],
            parameters=plan_tool.get_definition()["function"]["parameters"],
            handler=lambda args: plan_tool.run(args),
        )

        merge_tool = MergeResultsTool()
        registry.register(
            name=merge_tool.NAME,
            description=merge_tool.get_definition()["function"]["description"],
            parameters=merge_tool.get_definition()["function"]["parameters"],
            handler=lambda args: merge_tool.run(args),
        )

        generate_tool = ConfigGenerateTool(self)
        registry.register(
            name=generate_tool.NAME,
            description=generate_tool.get_definition()["function"]["description"],
            parameters=generate_tool.get_definition()["function"]["parameters"],
            handler=lambda args: generate_tool.run(args),
        )

        validate_tool = ConfigValidateTool(
            file_paths=self._file_paths,
            profiling_data=self._profiling_data,
            sample_size=validation_sample_size,
        )
        registry.register(
            name=validate_tool.NAME,
            description=validate_tool.get_definition()["function"]["description"],
            parameters=validate_tool.get_definition()["function"]["parameters"],
            handler=lambda args: validate_tool.run(args),
        )

        refine_tool = ConfigRefineTool(self)
        registry.register(
            name=refine_tool.NAME,
            description=refine_tool.get_definition()["function"]["description"],
            parameters=refine_tool.get_definition()["function"]["parameters"],
            handler=lambda args: refine_tool.run(args),
        )

        return registry

    def _build_agent_system_prompt(self) -> str:
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

    def _build_agent_task_message(
        self,
        auto_chunking: bool,
        chunk_max_columns: int,
        chunk_max_files: int,
    ) -> str:
        """构建 Agent 任务消息。"""
        parts = [
            f"为项目 '{self._project_name}' (id={self._project_id}) 生成数据验证配置。",
            "",
            "## 数据画像",
            self._format_profiling_for_agent(),
            "",
            "## 要求",
            "- 生成 schemas、constraints、regex_nodes",
            f"- keep_existing={'true' if self._generation_options.keep_existing else 'false'}",
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

    def _format_profiling_for_agent(self) -> str:
        """将画像数据格式化为文本。"""
        lines = []
        for item in self._profiling_data:
            table_name = item.get("table_name", "")
            lines.append(f"### {table_name}")
            lines.append(f"文件: {item.get('path', '')}")
            if item.get("sheet_name"):
                lines.append(f"Sheet: {item['sheet_name']}")
            for col in item.get("columns", []):
                samples = col.get("sample_values", [])[:3]
                samples_str = ", ".join(str(s)[:30] for s in samples)
                line = f"- {col['name']}: {col['dtype']}, 空值{col['null_count']}"
                if samples_str:
                    line += f", 例: {samples_str}"
                lines.append(line)
        return "\n".join(lines)

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
            profiling_data = self._filter_profiling(profiling_data, table_names, columns_filter)

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
        result = self._parse_response(response.content)
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
        result = self._parse_response(response.content)
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

    def _filter_profiling(
        self,
        profiling_data: list[dict],
        table_names: list[str] | None,
        columns_filter: list[str] | None,
    ) -> list[dict]:
        """根据 scope 过滤画像数据。"""
        result = []
        table_col_map: dict[str, list[str]] = {}
        if columns_filter:
            for tc in columns_filter:
                if "." in tc:
                    t, c = tc.split(".", 1)
                    table_col_map.setdefault(t, []).append(c)
                else:
                    table_col_map.setdefault("", []).append(tc)

        for item in profiling_data:
            table_name = item.get("table_name", "")
            if table_names and table_name not in table_names:
                continue

            columns = item.get("columns", [])
            if columns_filter:
                allowed = set(table_col_map.get(table_name, []) + table_col_map.get("", []))
                if allowed:
                    columns = [c for c in columns if c.get("name", "") in allowed]

            if columns:
                filtered = dict(item)
                filtered["columns"] = columns
                result.append(filtered)
        return result

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

    def _try_parse_config_from_content(self, content: str | None) -> dict[str, Any] | None:
        """从文本中解析配置。"""
        if not content:
            return None
        match = re.search(r"```(?:json)?\s*(.*?)\s*```", content, re.DOTALL)
        text = match.group(1).strip() if match else content
        start = text.find("{")
        if start == -1:
            return None
        balance = 0
        for i, char in enumerate(text[start:], start=start):
            if char == "{":
                balance += 1
            elif char == "}":
                balance -= 1
                if balance == 0:
                    try:
                        parsed = json.loads(text[start : i + 1])
                        if isinstance(parsed, dict):
                            return self._build_config_from_llm_result(parsed)
                    except json.JSONDecodeError:
                        return None
        return None

    async def _profile_files(self, file_paths: list[str], options: ProfilingOptions) -> list[dict]:
        """
        @methoddesc 分析数据文件获取画像

        读取各类数据文件的前 N 行，提取列名、数据类型、空值数和样本值。
        """
        import pandas as pd

        results = []

        # 限制最多处理的文件数量
        for path in file_paths[: options.max_files]:
            if self._cancelled:
                raise CancelledError("Generation cancelled")
            if not os.path.exists(path):
                continue

            ext = os.path.splitext(path)[1].lower()
            # 使用文件名（不含扩展名）作为默认表名
            table_name = os.path.splitext(os.path.basename(path))[0]

            try:
                # 根据文件类型读取数据
                sheet_name = None
                if ext in [".xlsx", ".xls"]:
                    # 读取第一个 sheet 的名称
                    xl = pd.ExcelFile(path)
                    sheet_name = xl.sheet_names[0] if xl.sheet_names else "Sheet1"
                    df = pd.read_excel(path, sheet_name=sheet_name, nrows=options.sample_rows)
                elif ext == ".csv":
                    df = pd.read_csv(path, nrows=options.sample_rows, encoding="utf-8")
                elif ext == ".json":
                    # JSON 文件处理
                    with open(path, encoding="utf-8") as f:
                        data = json.load(f)
                    # 处理嵌套结构
                    if isinstance(data, dict):
                        # 查找数据记录数组
                        records = self._find_json_records(data)
                        if records:
                            df = pd.json_normalize(records)
                        else:
                            df = pd.json_normalize([data])
                    elif isinstance(data, list):
                        df = pd.json_normalize(data)
                    else:
                        continue
                    # 限制行数
                    df = df.head(options.sample_rows)
                elif ext == ".jsonl":
                    # JSON Lines 文件处理
                    records = []
                    with open(path, encoding="utf-8") as f:
                        for i, line in enumerate(f):
                            if i >= options.sample_rows:
                                break
                            line = line.strip()
                            if line:
                                records.append(json.loads(line))
                    df = pd.json_normalize(records)
                else:
                    # 不支持的文件类型
                    continue

                # 分析列信息
                columns = []
                for col_name in df.columns:
                    if self._cancelled:
                        raise CancelledError("Generation cancelled")
                    col_data = df[col_name]

                    # 获取样本值（处理复杂类型如列表、字典）
                    # 使用 dict.fromkeys 保序去重，避免 list 的 O(n) in 查找导致的 O(n²) 开销
                    seen: dict[str, None] = {}
                    max_samples = options.sample_values_per_column
                    for v in col_data.dropna():
                        if len(seen) >= max_samples:
                            break
                        # 处理复杂类型并截断
                        v_str = str(v)[: options.max_cell_chars]
                        if v_str not in seen:
                            seen[v_str] = None
                    sample_values: list[str] = list(seen.keys())

                    columns.append(
                        {
                            "name": str(col_name),
                            "dtype": str(col_data.dtype),
                            "null_count": int(col_data.isna().sum()),
                            "sample_values": sample_values,
                        }
                    )

                result = {
                    "path": path,
                    "table_name": table_name,
                    "sheet_name": sheet_name,
                    "columns": columns,
                }
                results.append(result)

            except Exception as e:
                # 读取失败，记录警告并跳过，不影响其他文件的处理
                logger.warning(f"无法分析文件 {path}: {e}")
                continue

        return results

    def _find_json_records(self, data: dict) -> list[dict] | None:
        """
        @methoddesc 在嵌套 JSON 对象中查找数据记录数组

        策略：递归遍历 JSON 的所有节点，找到最长的、元素为字典的数组。
        """
        best_array = None
        best_length = 0

        def search(obj):
            nonlocal best_array, best_length

            if isinstance(obj, dict):
                for key, value in obj.items():
                    if isinstance(value, list):
                        # 检查是否是数据记录数组（元素是字典）
                        if value and isinstance(value[0], dict):
                            if len(value) > best_length:
                                best_length = len(value)
                                best_array = value
                        # 继续搜索数组内部（处理嵌套列表）
                        for item in value:
                            if isinstance(item, (dict, list)):
                                search(item)
                    elif isinstance(value, (dict, list)):
                        search(value)
            elif isinstance(obj, list):
                for item in obj:
                    if isinstance(item, (dict, list)):
                        search(item)

        search(data)
        return best_array

    def _parse_response(self, content: str) -> dict:
        """
        @methoddesc 解析 LLM 返回的文本，提取其中的 JSON 配置

        处理步骤：
        1. 尝试提取 Markdown 代码块（```json ... ```）中的内容
        2. 通过大括号平衡计数找到最外层的 JSON 对象
        3. 使用 json.loads 解析
        """
        original = content

        # 尝试找到 Markdown JSON 代码块
        match = re.search(r"```(?:json)?\s*(.*?)\s*```", content, re.DOTALL)
        if match:
            content = match.group(1).strip()

        # 通过大括号平衡计数找到最外层的 JSON 对象
        start = content.find("{")
        if start != -1:
            balance = 0
            for i, char in enumerate(content[start:], start=start):
                if char == "{":
                    balance += 1
                elif char == "}":
                    balance -= 1
                    if balance == 0:
                        content = content[start : i + 1]
                        break

        try:
            parsed = json.loads(content)
            if not isinstance(parsed, dict):
                raise GenerationParseError(
                    f"LLM 响应解析结果不是 JSON 对象，实际类型: {type(parsed).__name__}",
                    raw_content=original[:2000],
                )
            return parsed
        except json.JSONDecodeError as e:
            raise GenerationParseError(
                f"无法解析 LLM 响应为有效 JSON: {e}",
                raw_content=original[:2000],
            )

    def _load_existing_config(self, config_path: str) -> dict[str, Any] | None:
        """
        @methoddesc 加载现有配置（用于 keep_existing 合并）

        读取项目清单文件以及引用的 schema、constraint、regex 文件。
        """
        from pathlib import Path

        from app.shared.core.io.yaml import read_yaml

        manifest_path = os.path.join(config_path, "project.precis.yaml")
        if not os.path.isfile(manifest_path):
            return None

        try:
            manifest_data = read_yaml(Path(manifest_path))
            if not isinstance(manifest_data, dict):
                return None

            existing = {
                "manifest": manifest_data,
                "schemas": {},
                "constraints": {},
                "regex_nodes": {},
            }

            # 读取现有 schema 文件
            for ref in manifest_data.get("schemas", []):
                schema_path = os.path.join(config_path, ref.get("path", ""))
                if os.path.isfile(schema_path):
                    try:
                        raw = read_yaml(Path(schema_path))
                        if isinstance(raw, dict):
                            existing["schemas"][ref["id"]] = raw
                    except Exception as e:
                        logger.warning(f"读取现有 schema 文件失败 {schema_path}: {e}")

            # 读取现有 constraint 文件
            for ref in manifest_data.get("constraints", []):
                constraint_path = os.path.join(config_path, ref.get("path", ""))
                if os.path.isfile(constraint_path):
                    try:
                        raw = read_yaml(Path(constraint_path))
                        if isinstance(raw, dict):
                            existing["constraints"][ref["id"]] = raw
                    except Exception as e:
                        logger.warning(f"读取现有 constraint 文件失败 {constraint_path}: {e}")

            # 读取现有 regex 文件
            for ref in manifest_data.get("regex_nodes", []):
                regex_path = os.path.join(config_path, ref.get("path", ""))
                if os.path.isfile(regex_path):
                    try:
                        raw = read_yaml(Path(regex_path))
                        if isinstance(raw, dict):
                            existing["regex_nodes"][ref["id"]] = raw
                    except Exception as e:
                        logger.warning(f"读取现有 regex 文件失败 {regex_path}: {e}")

            return existing
        except Exception as e:
            logger.warning(f"加载现有配置失败: {e}")
            return None

    def cancel(self):
        """
        @methoddesc 标记生成任务为已取消状态

        异步任务会在合适的检查点检测到取消标记并抛出 CancelledError。
        """
        self._cancelled = True
