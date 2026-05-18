"""@fileoverview V2 YAML 配置生成器兼容模块

功能概述:
- 提供配置生成服务的向后兼容入口（generate_full_config_v2）
- 封装新版 ConfigGenerationService，适配旧版参数接口
"""

from __future__ import annotations

import asyncio

from app.shared.services.llm.generation import (
    ConfigGenerationService,
    GenerationOptions,
    ProfilingOptions,
)

# V2 清单文件名常量
V2_MANIFEST_FILENAME = "project.precis.yaml"


def generate_full_config_v2(
    data_paths,
    output_dir,
    profiling_options=None,
    generation_options=None,
    provider_id=None,
):
    """
    @methoddesc 生成完整 V2 项目配置（向后兼容的适配函数）

    内部使用新版 ConfigGenerationService，将旧版参数名适配为新接口：
    - data_paths -> file_paths
    - output_dir -> config_path

    参数:
        data_paths: 数据文件路径列表
        output_dir: 配置输出目录
        profiling_options: 数据画像选项，None 则使用默认值
        generation_options: 生成选项，None 则使用默认值
        provider_id: 指定使用的 AI Provider ID

    返回:
        生成结果字典，包含 manifest、schemas、constraints 等
    """
    service = ConfigGenerationService(provider_id=provider_id)

    if profiling_options is None:
        profiling_options = ProfilingOptions()
    if generation_options is None:
        generation_options = GenerationOptions()

    # 适配旧参数名：data_paths -> file_paths，output_dir -> config_path
    return asyncio.run(
        service.generate(
            file_paths=data_paths,
            project_name="generated_project",
            project_id="generated_project",
            config_path=output_dir,
            profiling_options=profiling_options,
            generation_options=generation_options,
        )
    )


def expand_data_input_paths(paths):
    """
    @methoddesc 展开数据输入路径

    如果传入的是目录，递归遍历其中所有支持的数据文件；
    如果传入的是文件，直接保留。

    参数:
        paths: 路径列表（文件或目录）

    返回:
        展开后的文件路径列表

    示例:
        >>> expand_data_input_paths(["./data"])
        ['./data/users.xlsx', './data/orders.csv']
    """
    import os

    expanded = []
    for path in paths:
        if os.path.isdir(path):
            # 递归遍历目录，收集所有支持的数据文件
            for root, dirs, files in os.walk(path):
                for file in files:
                    if file.endswith((".xlsx", ".csv", ".json", ".yaml", ".yml")):
                        expanded.append(os.path.join(root, file))
        elif os.path.isfile(path):
            expanded.append(path)
    return expanded


def profile_files(file_paths, options=None):
    """
    @methoddesc 分析文件画像

    收集每个文件的基本信息（大小、扩展名），用于快速了解数据输入。

    参数:
        file_paths: 文件路径列表
        options: 画像选项，None 则使用默认值

    返回:
        画像结果字典，包含 files 列表、total_count 和 sample
    """
    import os

    if options is None:
        options = ProfilingOptions()

    profiles = []
    for file_path in file_paths:
        if os.path.exists(file_path):
            stat = os.stat(file_path)
            profiles.append(
                {
                    "path": file_path,
                    "size": stat.st_size,
                    "extension": os.path.splitext(file_path)[1],
                }
            )

    return {
        "files": profiles,
        "total_count": len(profiles),
        "sample": profiles[: options.sample_rows] if profiles else [],
    }


# 为了向后兼容，保留旧名称
GenerateOptions = GenerationOptions

__all__ = [
    "ConfigGenerationService",
    "GenerationOptions",
    "GenerateOptions",  # 别名
    "ProfilingOptions",
    "V2_MANIFEST_FILENAME",
    "generate_full_config_v2",
    "expand_data_input_paths",
    "profile_files",
]
