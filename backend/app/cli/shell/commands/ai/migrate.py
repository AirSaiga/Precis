# backend/app/cli/shell/commands/ai/migrate.py
"""
@fileoverview CLI AI 配置迁移命令模块

功能概述:
- 提供 `ai migrate` 子命令，从旧脚本迁移生成 Precis V2 配置
- 支持 Python pandas / SQL / Excel 公式 / 自然语言
- 默认仅输出 YAML 预览，加 --apply 后写盘

架构设计:
- AIMigrateCommand 继承 Command 基类
- 直接调用 ConfigMigrationService，不依赖后端 HTTP
- 写盘逻辑委托 shared_services.generation_ops.apply_generated_config（CLI/TUI 同源）

输入示例:
    precis> ai migrate scripts/legacy_rules.sql data/users.xlsx
    precis> ai migrate rules.py data/*.xlsx --apply

输出示例:
    YAML 预览或写盘成功提示
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

from app.cli.shared_services.generation_ops import (
    SUPPORTED_EXTENSIONS,
)
from app.cli.shared_services.generation_ops import (
    apply_generated_config as _apply_generated_config,
)
from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.formatter import Formatter
from app.shared.services.ai.migrate_service import ConfigMigrationService
from app.shared.services.llm.generation import (
    GenerationOptions,
    ProfilingOptions,
)

logger = logging.getLogger(__name__)


def _infer_language(file_path: str) -> str:
    """根据文件扩展名推断脚本语言。"""
    lower = file_path.lower()
    if lower.endswith(".py"):
        return "python"
    if lower.endswith(".sql"):
        return "sql"
    if lower.endswith(".xlsx") or lower.endswith(".xls") or lower.endswith(".csv"):
        return "excel_formula"
    return "natural_language"


class AIMigrateCommand(Command):
    """AI 配置迁移命令。

    从旧脚本或业务描述迁移生成 Schema、Constraint、Regex 配置。
    默认输出 YAML 预览，使用 --apply 写入项目目录。
    """

    def __init__(self):
        super().__init__("migrate", aliases=["mig"])

    @property
    def description(self) -> str:
        return "从旧脚本迁移生成 Precis V2 配置"

    @property
    def usage(self) -> str:
        return "ai migrate <script_file> [data_files...] [--apply] [--language python|sql|excel_formula|natural_language] [--max-iterations N]"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行配置迁移命令。

        Args:
            args: 命令参数列表
            context: 项目上下文

        Returns:
            命令执行结果
        """
        if not context.is_project_open:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        project_path = context.project_path
        if not project_path:
            return CommandResult.error("项目路径为空")

        if not args:
            return CommandResult.error(f"请提供脚本文件路径\n用法: {self.usage}")

        # 解析参数
        script_path = args[0]
        file_patterns: list[str] = []
        apply = False
        language: str | None = None
        max_iterations = 2
        sample_rows = 100
        sample_values = 100

        i = 1
        while i < len(args):
            arg = args[i]
            if arg == "--apply":
                apply = True
            elif arg == "--language":
                i += 1
                if i < len(args):
                    language = args[i]
                else:
                    return CommandResult.error("--language 需要参数")
            elif arg == "--max-iterations":
                i += 1
                if i < len(args):
                    try:
                        max_iterations = max(1, min(5, int(args[i])))
                    except ValueError:
                        return CommandResult.error(f"--max-iterations 需要整数， got: {args[i]}")
                else:
                    return CommandResult.error("--max-iterations 需要参数")
            elif arg == "--sample-rows":
                i += 1
                if i < len(args):
                    try:
                        sample_rows = max(1, int(args[i]))
                    except ValueError:
                        return CommandResult.error(f"--sample-rows 需要整数， got: {args[i]}")
                else:
                    return CommandResult.error("--sample-rows 需要参数")
            elif arg == "--sample-values":
                i += 1
                if i < len(args):
                    try:
                        sample_values = max(1, int(args[i]))
                    except ValueError:
                        return CommandResult.error(f"--sample-values 需要整数， got: {args[i]}")
                else:
                    return CommandResult.error("--sample-values 需要参数")
            elif arg.startswith("--"):
                return CommandResult.error(f"未知参数: {arg}\n用法: {self.usage}")
            else:
                file_patterns.append(arg)
            i += 1

        # 解析脚本路径
        if not os.path.isabs(script_path):
            script_path = os.path.join(project_path, script_path)
        if not os.path.exists(script_path):
            return CommandResult.error(f"脚本文件不存在: {script_path}")

        if language is None:
            language = _infer_language(script_path)

        try:
            with open(script_path, encoding="utf-8") as f:
                script_content = f.read()
        except Exception as e:
            return CommandResult.error(f"读取脚本文件失败: {e}")

        # 展开数据文件路径
        file_paths: list[str] = []
        for pattern in file_patterns:
            if not os.path.isabs(pattern):
                pattern = os.path.join(project_path, pattern)
            import glob as _glob

            matched = _glob.glob(pattern)
            if matched:
                file_paths.extend(matched)
            elif os.path.exists(pattern):
                file_paths.append(pattern)

        file_paths = [p for p in file_paths if p.lower().endswith(SUPPORTED_EXTENSIONS)]
        if not file_paths:
            return CommandResult.error("请提供至少一个数据文件（.xlsx/.xls/.csv/.json/.jsonl）")

        # 获取项目信息
        config = context.project_config or {}
        project_name = config.get("project", {}).get("name", Path(project_path).name)
        project_id = config.get("project", {}).get("id", project_name)

        print(Formatter.header("\nAI 配置迁移"))
        print(Formatter.info(f"项目: {project_name}"))
        print(Formatter.info(f"脚本: {os.path.relpath(script_path, project_path)} ({language})"))
        print(Formatter.info("数据文件:"))
        for p in file_paths:
            print(f"  - {os.path.relpath(p, project_path)}")

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        def progress_callback(stage: str, progress: float, extra: dict[str, Any] | None = None) -> None:
            """终端进度回调。"""
            msg = extra.get("message") if extra else None
            prefix = f"[{stage}]" if not msg else f"[{stage}] {msg}"
            print(Formatter.info(f"  {prefix} {progress:.0f}%"))

        service = ConfigMigrationService()
        profiling_opts = ProfilingOptions(
            sample_rows=sample_rows,
            sample_values_per_column=sample_values,
        )
        gen_opts = GenerationOptions(
            generate_schemas=True,
            generate_constraints=True,
            generate_regex_nodes=False,
            keep_existing=True,
        )

        try:
            result = loop.run_until_complete(
                service.migrate_from_script(
                    script_content=script_content,
                    language=language,
                    file_paths=file_paths,
                    project_name=project_name,
                    project_id=project_id,
                    config_path=project_path,
                    profiling_options=profiling_opts,
                    generation_options=gen_opts,
                    max_iterations=max_iterations,
                    progress_callback=progress_callback,
                )
            )
        except Exception as e:
            logger.error(f"配置迁移失败: {e}", exc_info=True)
            return CommandResult.error(f"配置迁移失败: {e}")

        if not result.get("success"):
            error = result.get("error") or "配置迁移失败"
            return CommandResult.error(error)

        yaml_preview = result.get("yaml_preview", "")
        warnings = result.get("warnings", [])

        if warnings:
            print(Formatter.warning("\n迁移警告:"))
            for w in warnings:
                print(f"  - {w}")

        if apply:
            try:
                _apply_generated_config(result, project_path)
            except Exception as e:
                logger.error(f"写盘失败: {e}", exc_info=True)
                return CommandResult.error(f"配置已生成，但写盘失败: {e}")

            schema_count = len(result.get("schemas", {}))
            constraint_count = len(result.get("constraints", {}))
            regex_count = len(result.get("regex_nodes", {}))
            return CommandResult.ok(
                f"配置已迁移并写入项目：{schema_count} 个 schema，"
                f"{constraint_count} 个 constraint，{regex_count} 个 regex。"
            )

        print(Formatter.header("\nYAML 预览（未写盘，加 --apply 可应用）"))
        print(yaml_preview)
        return CommandResult.ok("配置迁移完成，以上为 YAML 预览。")


__all__ = ["AIMigrateCommand"]
