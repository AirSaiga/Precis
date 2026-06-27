"""@fileoverview AI 配置迁移服务

功能概述:
- 从旧脚本（Python pandas / 自然语言 / Excel 公式 / SQL）迁移生成 Precis V2 配置
- 复用 Agent 内核和配置生成/校验/精修工具

架构设计:
- 使用 AgentExecutor + ToolRegistry
- script_parse 工具解析意图
- generate_config 工具根据意图生成配置
- validate_config / refine_config 校验和精修
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.shared.services.ai.agent import AgentExecutor
from app.shared.services.ai.agent.planner import build_source_chunk_plan
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.ai.agent.tools import (
    ConfigGenerateTool,
    ConfigRefineTool,
    ConfigValidateTool,
    MergeResultsTool,
    PlanChunksTool,
    ScriptParseTool,
)
from app.shared.services.llm.generation import CancelledError
from app.shared.services.llm.generation.service import ConfigGenerationService

logger = logging.getLogger(__name__)


class ConfigMigrationService(ConfigGenerationService):
    """
    @classdesc 配置迁移服务

    从旧脚本迁移生成 Precis 配置，支持单脚本或批量脚本合并。
    """

    async def migrate_from_script(
        self,
        script_content: str,
        language: str,
        file_paths: list[str],
        project_name: str,
        project_id: str,
        config_path: str | None = None,
        profiling_options=None,
        generation_options=None,
        max_iterations: int = 2,
        validation_sample_size: int = 1000,
        progress_callback=None,
        checkpoint_callback=None,
        sources: list[dict[str, Any]] | None = None,
        chunk_max_sources: int = 5,
        chunk_max_tokens: int = 8000,
        enable_chunking: bool = True,
    ) -> dict[str, Any]:
        """
        @methoddesc 从脚本迁移生成配置

        参数:
            script_content: 脚本内容（单来源兼容字段）
            language: 脚本类型
            file_paths: 数据文件路径
            project_name: 项目名称
            project_id: 项目标识
            config_path: 项目配置路径
            profiling_options: 画像选项
            generation_options: 生成选项
            max_iterations: 最大迭代轮数
            validation_sample_size: 校验采样数
            progress_callback: 进度回调(stage, progress, extra)
            checkpoint_callback: checkpoint 回调
            sources: 批量脚本来源列表，每个元素含 content/language/name
            chunk_max_sources: 每个分片最大来源数
            chunk_max_tokens: 每个分片最大估算 token 数
            enable_chunking: 是否启用按源分片

        返回:
            完整配置字典
        """
        self._setup_run(
            file_paths=file_paths,
            project_name=project_name,
            project_id=project_id,
            config_path=config_path,
            profiling_options=profiling_options,
            generation_options=generation_options,
        )

        self._profiling_data = await self._profile_files(file_paths, self._profiling_options)
        if self._generation_options.keep_existing and config_path:
            self._existing_config = self._load_existing_config(config_path)

        # 统一转换为批量来源；若 script_content 与 sources 中首个内容相同，避免重复解析
        migrate_sources: list[dict[str, Any]] = []
        seen_contents = set()
        if sources:
            for s in sources:
                if not isinstance(s, dict) or not s.get("content"):
                    continue
                content = s["content"].strip()
                if content in seen_contents:
                    continue
                seen_contents.add(content)
                migrate_sources.append(
                    {
                        "content": content,
                        "language": s.get("language", language),
                        "name": s.get("name") or f"source_{len(migrate_sources) + 1}",
                    }
                )
        script_key = script_content.strip()
        if script_key and script_key not in seen_contents:
            migrate_sources.insert(
                0,
                {"content": script_key, "language": language, "name": "manual_paste"},
            )

        if not migrate_sources:
            return {
                "success": False,
                "error": "未提供任何脚本内容",
                "yaml_preview": "",
                "manifest": None,
                "schemas": {},
                "constraints": {},
                "regex_nodes": {},
                "warnings": [],
                "iterations": 0,
            }

        if self._cancelled:
            raise CancelledError()

        registry = self._create_migrate_registry(validation_sample_size)

        # 批量解析每个来源的意图
        parsed_intents = []
        total = len(migrate_sources)
        for idx, source in enumerate(migrate_sources):
            if self._cancelled:
                raise CancelledError()
            base_progress = idx / total * 0.4
            if progress_callback:
                progress_callback(
                    "parse_script",
                    base_progress,
                    {"iterations": 0, "current_source": source.get("name") or f"source_{idx + 1}"},
                )
            parse_tool = ScriptParseTool(self)
            intent = parse_tool.run(
                {
                    "script_content": source["content"],
                    "language": source.get("language", language),
                }
            )
            parsed_intents.append(
                {
                    "name": source.get("name") or f"source_{idx + 1}",
                    "language": source.get("language", language),
                    "intent": intent,
                }
            )

        # 按源分片规划
        source_plan = build_source_chunk_plan(
            parsed_intents,
            max_sources_per_chunk=chunk_max_sources,
            max_tokens_per_chunk=chunk_max_tokens,
        )
        chunk_total = len(source_plan.chunks)
        if progress_callback:
            progress_callback(
                "source_planning",
                0.35,
                {"iterations": 0, "chunk_total": chunk_total, "strategy": source_plan.strategy},
            )

        if not enable_chunking:
            # 显式关闭分片时走原有单次 Agent 路径，保持完全零回归
            return await self._migrate_single(
                parsed_intents,
                registry,
                max_iterations,
                progress_callback,
                checkpoint_callback,
            )

        provider = self._get_provider()
        # get_context_window 内部可能调用 Ollama 的同步 urllib 探测，放到线程池避免阻塞事件循环
        context_window = await asyncio.to_thread(provider.get_context_window)
        max_tokens = max(context_window - 8000, 4096)

        # 分片生成
        partial_configs: list[dict[str, Any]] = []
        for ci, chunk in enumerate(source_plan.chunks):
            if self._cancelled:
                raise CancelledError()
            chunk_index = ci + 1
            if progress_callback:
                progress_callback(
                    "chunk_generate",
                    0.35 + (ci / max(chunk_total, 1)) * 0.45,
                    {
                        "iterations": len(partial_configs),
                        "chunk_index": chunk_index,
                        "chunk_total": chunk_total,
                    },
                )

            chunk_intents = [parsed_intents[idx] for idx in chunk.source_indices]
            instructions = self._build_chunk_task_instructions(
                chunk_intents,
                chunk_total,
                chunk_index,
            )
            try:
                partial = await self._generate_for_chunk(instructions, previous_config=None)
            except Exception as e:
                logger.warning(f"分片 {chunk.chunk_id} 生成失败: {e}")
                partial = {}
            if partial.get("schemas") or partial.get("constraints") or partial.get("regex_nodes"):
                partial_configs.append(partial)

        if not partial_configs:
            return {
                "success": False,
                "error": "未能从脚本中解析出有效配置",
                "yaml_preview": "",
                "manifest": None,
                "schemas": {},
                "constraints": {},
                "regex_nodes": {},
                "warnings": [],
                "iterations": 0,
            }

        if progress_callback:
            progress_callback(
                "merge_results",
                0.85,
                {"iterations": len(partial_configs), "merged_chunks": chunk_total},
            )

        merge_tool = MergeResultsTool()
        merge_result = merge_tool.run({"configs": partial_configs})
        config = merge_result.get("config", {})
        warnings = list(merge_result.get("warnings", []))

        # 多分片时进行校验 + 精修兜底
        if chunk_total > 1:
            if progress_callback:
                progress_callback(
                    "refine_config",
                    0.9,
                    {
                        "iterations": len(partial_configs),
                        "metrics": {
                            "schemas": len(config.get("schemas", {})),
                            "constraints": len(config.get("constraints", {})),
                        },
                    },
                )
            try:
                config = await self._optional_refine_via_agent(
                    config,
                    registry=registry,
                    merge_warnings=warnings,
                    max_iterations=max_iterations,
                    max_tokens=max_tokens,
                    progress_callback=progress_callback,
                    checkpoint_callback=checkpoint_callback,
                )
            except Exception as e:
                logger.warning(f"精修阶段失败，使用合并结果: {e}")

        if not config.get("schemas") and not config.get("constraints"):
            return {
                "success": False,
                "error": "未能从脚本中解析出有效配置",
                "yaml_preview": "",
                "manifest": None,
                "schemas": {},
                "constraints": {},
                "regex_nodes": {},
                "warnings": warnings,
                "iterations": len(partial_configs),
            }

        config["success"] = True
        config["iterations"] = len(partial_configs)
        config["warnings"] = config.get("warnings", []) + warnings
        return config

    async def _migrate_single(
        self,
        parsed_intents: list[dict[str, Any]],
        registry: ToolRegistry,
        max_iterations: int,
        progress_callback,
        checkpoint_callback,
    ) -> dict[str, Any]:
        """单次 Agent 生成路径（显式关闭分片时的零回归路径）。"""
        if progress_callback:
            progress_callback("generate_config", 0.45, {"iterations": 0})

        provider = self._get_provider()
        context_window = await asyncio.to_thread(provider.get_context_window)
        max_tokens = max(context_window - 8000, 4096)
        executor = AgentExecutor(
            provider=provider,
            registry=registry,
            system_prompt=self._build_migrate_system_prompt(),
            max_iterations=max_iterations,
            max_tokens=max_tokens,
            progress_callback=lambda stage, progress, extra: (
                progress_callback(stage, 0.5 + progress * 0.5, extra) if progress_callback else None
            ),
            checkpoint_callback=checkpoint_callback,
            cancelled_callback=lambda: self._cancelled,
        )

        task_message = self._build_migrate_task_message(parsed_intents)
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
            }

        config = agent_result.config or {}
        if not config:
            config = self._try_parse_config_from_content(agent_result.content) or {}

        if not config.get("schemas") and not config.get("constraints"):
            return {
                "success": False,
                "error": "未能从脚本中解析出有效配置",
                "yaml_preview": "",
                "manifest": None,
                "schemas": {},
                "constraints": {},
                "regex_nodes": {},
                "warnings": [],
                "iterations": agent_result.iterations,
            }

        config["success"] = True
        config["iterations"] = agent_result.iterations
        config["warnings"] = config.get("warnings", [])
        return config

    async def _generate_for_chunk(
        self,
        instructions: str,
        previous_config: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """为单个分片生成配置，复用父类 _generate_config_for_scope。"""
        return await self._generate_config_for_scope(
            file_paths=self._file_paths,
            instructions=instructions,
            previous_config=previous_config,
            scope={"file_paths": self._file_paths},
        )

    def _build_chunk_task_instructions(
        self,
        chunk_intents: list[dict[str, Any]],
        chunk_total: int,
        chunk_index: int,
    ) -> str:
        """构建分片生成指令。"""
        intent_sections = []
        for item in chunk_intents:
            intent_sections.append(f"### 来源: {item['name']} ({item['language']})\n{item['intent']}")
        intents_text = "\n\n".join(intent_sections)

        parts = [
            f"这是第 {chunk_index}/{chunk_total} 个分片，请仅基于本分片包含的来源意图生成配置。",
            "",
            "## 本分片已解析的迁移意图",
            intents_text,
            "",
            "## 数据画像（全量上下文可见）",
            self._format_profiling_for_agent(),
            "",
            "## 要求",
            "- 仅生成本分片来源涉及的表、列、约束和正则",
            "- 保持与数据画像一致",
            "- 返回完整 JSON 配置（schemas、constraints、regex_nodes）",
        ]
        return "\n".join(parts)

    async def _optional_refine_via_agent(
        self,
        config: dict[str, Any],
        registry: ToolRegistry,
        merge_warnings: list[str],
        max_iterations: int,
        max_tokens: int,
        progress_callback,
        checkpoint_callback,
    ) -> dict[str, Any]:
        """多分片合并后，通过 Agent 做校验 + 精修兜底。"""
        provider = self._get_provider()
        executor = AgentExecutor(
            provider=provider,
            registry=registry,
            system_prompt=self._build_migrate_system_prompt(),
            max_iterations=max_iterations,
            max_tokens=max_tokens,
            progress_callback=lambda stage, progress, extra: (
                progress_callback(stage, 0.9 + progress * 0.05, extra) if progress_callback else None
            ),
            checkpoint_callback=checkpoint_callback,
            cancelled_callback=lambda: self._cancelled,
        )

        parts = [
            "以下配置由多个来源分片分别生成后合并而来，请做最终校验与精修。",
            "",
            "## 合并后配置",
            self._summarize_config(config),
            "",
            "## 合并阶段警告",
            "\n".join(merge_warnings) if merge_warnings else "无",
            "",
            "## 要求",
            "- 检查跨来源冲突、重复约束、遗漏规则",
            "- 调用 validate_config 校验",
            "- 必要时调用 refine_config 修正",
            "- 最终调用 generate_config 输出完整配置",
        ]
        task_message = "\n".join(parts)
        agent_result = await executor.run(task_message)

        if agent_result.success and agent_result.config:
            return agent_result.config

        # 精修失败或没有输出时，回退到合并结果
        return config

    def _create_migrate_registry(self, validation_sample_size: int) -> ToolRegistry:
        """创建迁移工具注册表。"""
        registry = ToolRegistry()

        plan_tool = PlanChunksTool(
            profiling_data=self._profiling_data,
            file_paths=self._file_paths,
            chunk_max_columns=20,
            chunk_max_files=5,
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

        parse_tool = ScriptParseTool(self)
        registry.register(
            name=parse_tool.NAME,
            description=parse_tool.get_definition()["function"]["description"],
            parameters=parse_tool.get_definition()["function"]["parameters"],
            handler=lambda args: parse_tool.run(args),
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

    def _build_migrate_system_prompt(self) -> str:
        """构建迁移系统提示词。"""
        return """你是一个数据治理专家 Agent，擅长从旧脚本或业务描述中迁移生成 Precis V2 数据验证配置。

可用工具：
1. plan_chunks: 根据数据画像生成分块计划（大数据量时先调用）。
2. merge_results: 合并多个分片生成的配置（分块生成后使用）。
3. parse_script: 解析旧脚本或自然语言描述，输出规则意图。
4. generate_config: 根据数据画像和规则意图生成配置。这是最终输出工具，调用后任务即结束。
5. validate_config: 校验生成的配置。
6. refine_config: 根据校验问题修正配置。

工作原则：
- 当来源数量少时，直接综合调用 generate_config 生成统一配置。
- 当来源数量大时，服务层已按源拆分为多个分片分别生成并合并；你的职责是校验合并结果、处理冲突并精修。
- 如多个来源对同一表/列定义冲突，以数据画像为准并保留所有不冲突规则。
- 生成后校验并精修。
- 最终返回完整 JSON 配置。"""

    def _build_migrate_task_message(self, parsed_intents: list[dict[str, Any]]) -> str:
        """构建迁移任务消息。"""
        intent_sections = []
        for item in parsed_intents:
            intent_sections.append(f"### 来源: {item['name']} ({item['language']})\n{item['intent']}")
        intents_text = "\n\n".join(intent_sections)

        parts = [
            "从以下旧脚本/描述来源迁移生成 Precis V2 数据验证配置。",
            "",
            "## 已解析的迁移意图",
            intents_text,
            "",
            "## 数据画像",
            self._format_profiling_for_agent(),
            "",
            "## 要求",
            "- 综合所有来源意图，生成统一、无冲突的完整配置",
            "- 校验并精修",
            "- 最终返回完整 JSON 配置",
        ]
        return "\n".join(parts)
