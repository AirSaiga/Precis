# backend/app/cli/shell/commands/ai/generate.py
"""
@fileoverview CLI AI 配置生成命令模块

功能概述:
- 提供 `ai generate` 子命令，从数据文件生成 Precis V2 配置
- 支持 Agent 多轮优化模式（默认）和单次快速生成模式
- 默认仅输出 YAML 预览，加 --apply 后写盘
- 无文件参数时自动扫描项目 data/ 目录并交互式选择

架构设计:
- AIGenerateCommand 继承 Command 基类
- 直接调用 ConfigGenerationService，不依赖后端 HTTP
- 写盘与数据文件扫描逻辑委托 shared_services.generation_ops（CLI/TUI 同源）
- _scan_data_files 保留为单参数向后兼容入口，等价 scan_data_files([], project_path)

输入示例:
    precis> ai generate data/users.xlsx
    precis> ai generate data/*.xlsx --apply --max-iterations 3

输出示例:
    YAML 预览或写盘成功提示
"""

from __future__ import annotations

import asyncio
import glob
import logging
import os
from pathlib import Path
from typing import Any

from app.cli.shared_services.generation_ops import (
    SUPPORTED_EXTENSIONS,
    apply_generated_config,
    scan_data_files,
)
from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.formatter import Formatter
from app.shared.services.llm.generation import (
    ConfigGenerationService,
    GenerationOptions,
    ProfilingOptions,
)

logger = logging.getLogger(__name__)


def _scan_data_files(project_path: str) -> list[str]:
    """扫描项目 data/ 目录下的支持文件（向后兼容入口）。

    真正的实现已迁移到 shared_services.generation_ops.scan_data_files（CLI/TUI 同源）。
    本函数保留单参数签名以兼容历史调用与现有测试，等价于 scan_data_files([], project_path)。

    Args:
        project_path: 项目根目录

    Returns:
        绝对路径列表
    """
    return scan_data_files([], project_path)


class AIGenerateCommand(Command):
    """AI 配置生成命令。

    从数据文件分析并生成 Schema、Constraint、Regex 配置。
    默认输出 YAML 预览，使用 --apply 写入项目目录。
    """

    def __init__(self):
        super().__init__("generate", aliases=["gen"])

    @property
    def description(self) -> str:
        return "从数据文件生成 Precis V2 配置"

    @property
    def usage(self) -> str:
        return "ai generate [files...] [--apply] [--no-agent-mode] [--max-iterations N] [--sample-rows N]"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行配置生成命令。

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

        # 解析参数
        file_patterns: list[str] = []
        apply = False
        agent_mode = True
        max_iterations = 2
        sample_rows = 100
        sample_values = 100
        generate_regex = False

        i = 0
        while i < len(args):
            arg = args[i]
            if arg == "--apply":
                apply = True
            elif arg == "--no-agent-mode":
                agent_mode = False
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
            elif arg == "--generate-regex":
                generate_regex = True
            elif arg.startswith("--"):
                return CommandResult.error(f"未知参数: {arg}\n用法: {self.usage}")
            else:
                file_patterns.append(arg)
            i += 1

        # 展开文件路径（支持通配符和相对路径）
        file_paths: list[str] = []
        for pattern in file_patterns:
            if not os.path.isabs(pattern):
                pattern = os.path.join(project_path, pattern)
            matched = glob.glob(pattern)
            if matched:
                file_paths.extend(matched)
            elif os.path.exists(pattern):
                file_paths.append(pattern)

        # 无文件参数时扫描 data/ 目录（委托 shared_services 双参数版本）
        if not file_paths:
            scanned = scan_data_files([], project_path)
            if not scanned:
                return CommandResult.error(
                    "未找到数据文件。请在项目 data/ 目录放置 .xlsx/.csv/.json 文件，或显式指定文件路径。"
                )
            file_paths = scanned

        # 过滤支持的文件类型
        file_paths = [p for p in file_paths if p.lower().endswith(SUPPORTED_EXTENSIONS)]
        if not file_paths:
            return CommandResult.error("未找到支持的数据文件类型（.xlsx/.xls/.csv/.json/.jsonl）")

        # 获取项目信息
        config = context.project_config or {}
        project_name = config.get("project", {}).get("name", Path(project_path).name)
        project_id = config.get("project", {}).get("id", project_name)

        # 输出待处理文件
        print(Formatter.header("\nAI 配置生成"))
        print(Formatter.info(f"项目: {project_name}"))
        print(Formatter.info(f"Agent 模式: {'开启' if agent_mode else '关闭'}"))
        print(Formatter.info(f"迭代次数: {max_iterations}"))
        print(Formatter.info("数据文件:"))
        for p in file_paths:
            print(f"  - {os.path.relpath(p, project_path)}")

        # 异步执行生成
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

        service = ConfigGenerationService()
        profiling_opts = ProfilingOptions(
            sample_rows=sample_rows,
            sample_values_per_column=sample_values,
        )
        gen_opts = GenerationOptions(
            generate_schemas=True,
            generate_constraints=True,
            generate_regex_nodes=generate_regex,
            keep_existing=True,
        )

        try:
            if agent_mode:
                result = loop.run_until_complete(
                    service.generate_with_agent(
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
            else:
                result = loop.run_until_complete(
                    service.generate(
                        file_paths=file_paths,
                        project_name=project_name,
                        project_id=project_id,
                        config_path=project_path,
                        profiling_options=profiling_opts,
                        generation_options=gen_opts,
                        progress_callback=lambda stage, progress: progress_callback(stage, progress, None),
                    )
                )
        except Exception as e:
            logger.error(f"配置生成失败: {e}", exc_info=True)
            return CommandResult.error(f"配置生成失败: {e}")

        if not result.get("success"):
            error = result.get("error") or "配置生成失败"
            return CommandResult.error(error)

        yaml_preview = result.get("yaml_preview", "")
        warnings = result.get("warnings", [])

        if warnings:
            print(Formatter.warning("\n生成警告:"))
            for w in warnings:
                print(f"  - {w}")

        if apply:
            try:
                apply_generated_config(result, project_path)
            except Exception as e:
                logger.error(f"写盘失败: {e}", exc_info=True)
                return CommandResult.error(f"配置已生成，但写盘失败: {e}")

            schema_count = len(result.get("schemas", {}))
            constraint_count = len(result.get("constraints", {}))
            regex_count = len(result.get("regex_nodes", {}))
            return CommandResult.ok(
                f"配置已生成并写入项目：{schema_count} 个 schema，"
                f"{constraint_count} 个 constraint，{regex_count} 个 regex。"
            )

        # 默认仅输出预览
        print(Formatter.header("\nYAML 预览（未写盘，加 --apply 可应用）"))
        print(yaml_preview)
        return CommandResult.ok("配置生成完成，以上为 YAML 预览。")


__all__ = ["AIGenerateCommand"]
