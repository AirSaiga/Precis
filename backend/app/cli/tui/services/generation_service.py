# backend/app/cli/tui/services/generation_service.py
"""@fileoverview TUI AI 配置生成/迁移服务

功能概述:
- 收敛 TUI 的「ai generate」与「ai migrate」两个屏所需的核心业务调用
- 直接复用 app.shared 的 ConfigGenerationService / ConfigMigrationService（纯服务）
- 写盘与数据文件扫描委托 shared_services.generation_ops（CLI/TUI 同源，P0b 抽出）

架构设计:
- 本 service 只做「薄壳编排」：构造 ProfilingOptions/GenerationOptions、调底层 service、
  把进度回调透传给上层（TUI 状态条），写盘统一委托 generation_ops.apply_generated_config
- 不含任何 UI/交互逻辑，便于独立单测（mock ConfigGenerationService 即可）
- 参数对象构建规则参考 CLI generate.py:257-266 与 migrate.py:208-217，保持两端一致

输入示例:
    svc = GenerationService()
    result = await svc.generate(file_paths, project_name="demo", project_id="demo",
                                config_path="/proj", agent_mode=True, max_iterations=2)

输出示例:
    {
        "success": True, "yaml_preview": "...",
        "manifest": {...}, "schemas": {...}, "constraints": {...},
        "regex_nodes": {...}, "warnings": []
    }
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from app.cli.shared_services import generation_ops
from app.shared.services.ai.migrate_service import ConfigMigrationService
from app.shared.services.llm.generation import (
    ConfigGenerationService,
    GenerationOptions,
    ProfilingOptions,
)

logger = logging.getLogger(__name__)

# 进度回调签名：(阶段, 进度百分比 0-100, 附加上下文) -> None。
# 与 ConfigGenerationService.generate_with_agent 的 progress_callback 完全一致。
ProgressCallback = Callable[[str, float, dict[str, Any] | None], None]


class GenerationService:
    """TUI 配置生成/迁移服务。

    封装 ConfigGenerationService / ConfigMigrationService 的调用，对外暴露：
    - generate：从数据文件生成配置（Agent 多轮 / 单次两种模式）
    - migrate：从旧脚本迁移生成配置
    - apply_result：把生成结果落盘到项目目录（委托 generation_ops）

    该类不持有 provider 状态——构造底层 service 时不传 provider_id，由其内部读取默认
    Provider 配置（与 CLI 行为一致）。
    """

    def __init__(self) -> None:
        """初始化生成/迁移服务。

        底层 service 按需在 generate/migrate 内部创建（provider_id=None 使用默认 Provider），
        避免在构造期触发任何 IO。
        """
        self._generation_service = ConfigGenerationService()
        self._migration_service = ConfigMigrationService()

    async def generate(
        self,
        file_paths: list[str],
        project_name: str,
        project_id: str,
        config_path: str | None = None,
        *,
        agent_mode: bool = True,
        max_iterations: int = 2,
        sample_rows: int = 100,
        sample_values_per_column: int = 100,
        generate_regex: bool = False,
        on_progress: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        """从数据文件生成 Precis 配置。

        Args:
            file_paths: 数据文件绝对路径列表（已由 generation_ops.scan_data_files 展开）
            project_name: 项目名称
            project_id: 项目标识
            config_path: 项目根路径（用于加载现有配置 + 写盘）
            agent_mode: True 走 generate_with_agent（多轮优化），False 走单次 generate
            max_iterations: Agent 模式最大迭代轮数（1-5）
            sample_rows: 数据画像采样行数
            sample_values_per_column: 每列采样值数量
            generate_regex: 是否生成 Regex 节点
            on_progress: 进度回调（透传给底层 service）

        Returns:
            底层 service 返回的配置字典（含 success/manifest/schemas/...）
        """
        # 参数构建（参考 CLI generate.py:204-213，保持两端一致）
        profiling_opts = ProfilingOptions(
            sample_rows=sample_rows,
            sample_values_per_column=sample_values_per_column,
        )
        gen_opts = GenerationOptions(
            generate_schemas=True,
            generate_constraints=True,
            generate_regex_nodes=generate_regex,
            keep_existing=True,
        )

        if agent_mode:
            return await self._generation_service.generate_with_agent(
                file_paths=file_paths,
                project_name=project_name,
                project_id=project_id,
                config_path=config_path,
                profiling_options=profiling_opts,
                generation_options=gen_opts,
                max_iterations=max_iterations,
                progress_callback=on_progress,
            )
        # 单次模式底层回调签名是 (stage, progress)，此处适配为三参回调
        single_progress = self._adapt_single_progress(on_progress)
        return await self._generation_service.generate(
            file_paths=file_paths,
            project_name=project_name,
            project_id=project_id,
            config_path=config_path,
            profiling_options=profiling_opts,
            generation_options=gen_opts,
            progress_callback=single_progress,
        )

    async def migrate(
        self,
        script_content: str,
        language: str,
        file_paths: list[str],
        project_name: str,
        project_id: str,
        config_path: str | None = None,
        *,
        max_iterations: int = 2,
        sample_rows: int = 100,
        sample_values_per_column: int = 100,
        on_progress: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        """从旧脚本迁移生成 Precis 配置。

        Args:
            script_content: 脚本原文
            language: 脚本语言（python/sql/excel_formula/natural_language）
            file_paths: 数据文件绝对路径列表
            project_name: 项目名称
            project_id: 项目标识
            config_path: 项目根路径
            max_iterations: 最大迭代轮数（1-5）
            sample_rows: 数据画像采样行数
            sample_values_per_column: 每列采样值数量
            on_progress: 进度回调（透传给底层 service）

        Returns:
            底层 service 返回的配置字典
        """
        # 参数构建（参考 CLI migrate.py:208-217，迁移不生成 regex 节点）
        profiling_opts = ProfilingOptions(
            sample_rows=sample_rows,
            sample_values_per_column=sample_values_per_column,
        )
        gen_opts = GenerationOptions(
            generate_schemas=True,
            generate_constraints=True,
            generate_regex_nodes=False,
            keep_existing=True,
        )

        return await self._migration_service.migrate_from_script(
            script_content=script_content,
            language=language,
            file_paths=file_paths,
            project_name=project_name,
            project_id=project_id,
            config_path=config_path,
            profiling_options=profiling_opts,
            generation_options=gen_opts,
            max_iterations=max_iterations,
            progress_callback=on_progress,
        )

    def apply_result(self, result: dict[str, Any], project_path: str) -> list[str]:
        """把生成/迁移结果写入项目目录。

        委托 shared_services.generation_ops.apply_generated_config，写盘规则与 CLI 完全一致：
        覆盖 project.precis.yaml + schemas/ + constraints/ + regex/。

        Args:
            result: generate/migrate 返回的配置字典
            project_path: 项目根目录

        Returns:
            已写入的文件相对路径列表
        """
        return generation_ops.apply_generated_config(result, project_path)

    @staticmethod
    def scan_data_files(patterns: list[str], project_path: str) -> list[str]:
        """展开数据文件路径（委托 generation_ops.scan_data_files）。

        Args:
            patterns: 用户输入的文件模式列表（为空则扫描 data/ 目录）
            project_path: 项目根目录

        Returns:
            数据文件绝对路径列表
        """
        return generation_ops.scan_data_files(patterns, project_path)

    @staticmethod
    def _adapt_single_progress(
        on_progress: ProgressCallback | None,
    ) -> Callable[[str, float], None] | None:
        """把单次 generate 的 (stage, progress) 回调适配为三参回调。

        单次模式的底层回调签名是 ``Callable[[str, float], None]``，而 TUI 状态条统一用
        ``(stage, progress, extra)`` 三参。这里注入一个适配器，extra 传 None。
        """
        if on_progress is None:
            return None

        def _adapter(stage: str, progress: float) -> None:
            on_progress(stage, progress, None)

        return _adapter


__all__ = ["GenerationService", "ProgressCallback"]
