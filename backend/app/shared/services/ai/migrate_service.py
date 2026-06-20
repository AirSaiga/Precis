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

import logging
from typing import Any

from app.shared.services.ai.agent import AgentExecutor
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.ai.agent.tools import (
    ConfigGenerateTool,
    ConfigRefineTool,
    ConfigValidateTool,
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
        migrate_sources = []
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

        provider = self._get_provider()
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

        if progress_callback:
            progress_callback("generate_config", 0.45, {"iterations": 0})

        provider = self._get_provider()
        context_window = provider.get_context_window()
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

    def _create_migrate_registry(self, validation_sample_size: int) -> ToolRegistry:
        """创建迁移工具注册表。"""
        registry = ToolRegistry()

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
1. parse_script: 解析旧脚本或自然语言描述，输出规则意图。
2. generate_config: 根据数据画像和规则意图生成配置。
3. validate_config: 校验生成的配置。
4. refine_config: 根据校验问题修正配置。

工作原则：
- 输入中已包含所有来源的解析意图，直接综合调用 generate_config 生成统一配置。
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
