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
from app.shared.services.llm.generation.service import ConfigGenerationService

logger = logging.getLogger(__name__)


class ConfigMigrationService(ConfigGenerationService):
    """
    @classdesc 配置迁移服务

    从旧脚本迁移生成 Precis 配置。
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
    ) -> dict[str, Any]:
        """
        @methoddesc 从脚本迁移生成配置

        参数:
            script_content: 脚本内容
            language: 脚本类型
            file_paths: 数据文件路径
            project_name: 项目名称
            project_id: 项目标识
            config_path: 项目配置路径
            profiling_options: 画像选项
            generation_options: 生成选项
            max_iterations: 最大迭代轮数
            validation_sample_size: 校验采样数
            progress_callback: 进度回调
            checkpoint_callback: checkpoint 回调

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

        provider = self._get_provider()
        registry = self._create_migrate_registry(validation_sample_size)

        executor = AgentExecutor(
            provider=provider,
            registry=registry,
            system_prompt=self._build_migrate_system_prompt(),
            max_iterations=max_iterations,
            progress_callback=lambda stage, progress, extra: (
                progress_callback(stage, progress, extra) if progress_callback else None
            ),
            checkpoint_callback=checkpoint_callback,
            cancelled_callback=lambda: self._cancelled,
        )

        task_message = self._build_migrate_task_message(script_content, language)
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
- 先调用 parse_script 解析脚本意图。
- 根据意图调用 generate_config 生成配置（scope 中可包含解析出的意图）。
- 生成后校验并精修。
- 最终返回完整 JSON 配置。"""

    def _build_migrate_task_message(self, script_content: str, language: str) -> str:
        """构建迁移任务消息。"""
        parts = [
            f"从以下 {language} 脚本/描述迁移生成 Precis V2 数据验证配置。",
            "",
            "## 脚本内容",
            script_content,
            "",
            "## 数据画像",
            self._format_profiling_for_agent(),
            "",
            "## 要求",
            "- 先解析脚本意图，再生成配置",
            "- 校验并精修",
            "- 最终返回完整 JSON 配置",
        ]
        return "\n".join(parts)
