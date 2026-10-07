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
from collections.abc import Callable
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
from app.shared.services.llm.generation import CancelledError, GenerationOptions, ProfilingOptions
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
        profiling_options: ProfilingOptions | None = None,
        generation_options: GenerationOptions | None = None,
        max_iterations: int = 2,
        validation_sample_size: int = 1000,
        progress_callback: Callable[..., Any] | None = None,
        checkpoint_callback: Callable[..., Any] | None = None,
        sources: list[dict[str, Any]] | None = None,
        initial_checkpoint: dict[str, Any] | None = None,
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
                initial_checkpoint=initial_checkpoint,
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
        config: dict[str, Any] = merge_result.get("config", {})
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
        config["warnings"] = list(config.get("warnings", [])) + warnings
        return config

    async def _migrate_single(
        self,
        parsed_intents: list[dict[str, Any]],
        registry: ToolRegistry,
        max_iterations: int,
        progress_callback: Callable[..., Any] | None,
        checkpoint_callback: Callable[..., Any] | None,
        initial_checkpoint: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """单次 Agent 生成路径（显式关闭分片时的零回归路径）。

        支持 initial_checkpoint 续跑（与 generation 路径一致）：传入时从断点恢复 memory。
        """
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
            "- 列名保真（硬约束）：schema 列的 id/name 与约束/正则的列引用必须与数据画像列名逐字一致，禁止翻译或改写（如 order_id 不得写成 订单ID）",
            "- 只迁移已解析的意图：约束必须来自上方迁移意图，禁止凭数据画像发明规则；本分片意图为空或不含校验规则时，不得产出任何约束/正则",
            "- 意图冲突时（同一表/列出现互相矛盾的规则）：以数据画像为准保留一条约束，禁止整体丢弃该规则",
            "- 带参数的约束必须携带从规则中提取的具体参数（如 Range 的 min/max、AllowedValues 的 allowed_values、Charset 的 charset_mode），缺参数的约束无效",
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
        progress_callback: Callable[..., Any] | None,
        checkpoint_callback: Callable[..., Any] | None,
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
            "- 冲突规则（同一表/列互相矛盾）不得整体丢弃：以数据画像为准保留一条约束",
            "- 校验确认每个约束携带完整参数（Range 的 min/max、AllowedValues 的 allowed_values 等），剔除或修正无参数的无效约束时必须保留规则本体",
            "- 调用 validate_config 校验",
            "- 必要时调用 refine_config 修正",
            "- 最终调用 generate_config 输出完整配置",
        ]
        task_message = "\n".join(parts)
        agent_result = await executor.run(task_message)

        if agent_result.success and agent_result.config:
            refined = agent_result.config
            # Agent 直接输出 JSON 时 schemas 可能是 list，需要归一化为 build_config 格式
            if isinstance(refined.get("schemas"), list):
                refined = self._build_config_from_llm_result(refined)
            return refined

        # 精修失败或没有输出时，回退到合并结果
        return config

    def _create_migrate_registry(self, validation_sample_size: int) -> ToolRegistry:
        """创建迁移工具注册表。"""
        registry = ToolRegistry()

        # 工具注册统一走 register_tool（name/description/parameters/handler 自动提取）
        registry.register_tool(
            PlanChunksTool(
                profiling_data=self._profiling_data,
                file_paths=self._file_paths,
                chunk_max_columns=20,
                chunk_max_files=5,
            )
        )
        registry.register_tool(MergeResultsTool())
        registry.register_tool(ScriptParseTool(self))
        registry.register_tool(ConfigGenerateTool(self))
        registry.register_tool(
            ConfigValidateTool(
                file_paths=self._file_paths,
                profiling_data=self._profiling_data,
                sample_size=validation_sample_size,
            )
        )
        registry.register_tool(ConfigRefineTool(self))

        return registry

    def _build_migrate_system_prompt(self) -> str:
        """构建迁移系统提示词。"""
        return """You are a data governance expert agent skilled at migrating legacy scripts or business descriptions into Precis V2 data validation configurations.

Available tools:
1. plan_chunks: build a chunking plan from the data profile (call this first for large datasets).
2. merge_results: merge configurations generated from multiple chunks (use after chunked generation).
3. parse_script: parse a legacy script or natural-language description into rule intents.
4. generate_config: generate a configuration from the data profile and rule intents. This is the final output tool — the task ends once it is called.
5. validate_config: validate the generated configuration.
6. refine_config: correct the configuration based on validation issues.

Rule-to-constraint type mapping (the ONLY supported constraint types — map every parsed rule to one of them):
- Missing-value / not-null checks ("不能为空", notna, IS NOT NULL) → NotNull.
- Uniqueness checks (is_unique, DISTINCT, "不能重复") → Unique (multi-column uniqueness uses refs.column_ids).
- Enumeration / domain lists (isin([...]), IN (...), "只能是 A、B、C") → AllowedValues (params.allowed_values must carry the values).
- Numeric bounds or comparisons (age >= 0, between(0, 120), CHECK (age > 0)) → Range; params MUST carry at least one of min/max extracted verbatim from the rule — a Range with both min and max omitted is invalid and will be rejected.
- Cross-table references (FOREIGN KEY ... REFERENCES) → ForeignKey.
- If-then rules ("当 X 时 Y 必须...") → Conditional (params.then_condition required).
- Regex / format patterns (str.match, r'^...$') → Scripted (params.expression) or a regex_node.
- Character-set restrictions ("必须是中文/中文混合字符集", "只能含中文", ASCII-only) → Charset with params.charset_mode = chinese / chinese_mixed / ascii. Do NOT downgrade a character-set rule to NotNull or any other type.
- Date comparisons / age calculations (birth_date > '1900-01-01', 年龄 >= 18) → DateLogic (with the reference date/column or calculation params).
- Rules combining several of the above on one column → Composite.

Working principles:
- Column name fidelity is a hard requirement: column ids/names in generated schemas must exactly match the data profile column names verbatim. Never translate, transliterate, or rewrite them (e.g. order_id -> 订单ID is forbidden), even when the project name or legacy script is in Chinese; mismatched column names break validation against the data files.
- Migrate exactly the rules that were parsed. Parsed intents are the only source of validation rules: never invent, extrapolate, or broaden rules from the data profile alone. If the parsed intents contain no actual validation rule, produce no constraints/regex_nodes for it (a schema-only result is acceptable) — a clean empty result is always better than a hallucinated constraint.
- Conflict resolution: when multiple sources or chunks define conflicting rules for the same table/column (e.g. age between 0-120 vs 0-200), NEVER drop the constraint entirely. Keep exactly one constraint per (table, column, type), choosing the variant consistent with the data profile (values that all profiled data satisfies); an empty constraint set is only acceptable when there are genuinely no parseable rules.
- When there are few sources, synthesize them directly and call generate_config to produce a unified configuration.
- When there are many sources, the service layer has already split them into chunks, generated and merged them; your job is to validate the merged result, resolve conflicts, and refine it.
- Validate and refine after generation.
- Return the complete JSON configuration in the end."""

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
            "- 列名保真（硬约束）：schema 列的 id/name 与约束/正则的列引用必须与数据画像列名逐字一致，禁止翻译或改写（如 order_id 不得写成 订单ID）",
            "- 只迁移已解析的意图：禁止凭数据画像发明规则；意图为空或不含校验规则时干净返回（无约束），不得幻觉约束",
            "- 来源间规则冲突时：以数据画像为准保留一条约束，禁止整体丢弃该规则",
            "- 带参数的约束必须携带具体参数（如 Range 的 min/max），缺参数的约束无效",
            "- 校验并精修",
            "- 最终返回完整 JSON 配置",
        ]
        return "\n".join(parts)
