"""
@fileoverview AI 配置生成 API 路由模块 (V2)

功能概述:
- 同步生成 V2 项目配置（manifest、schema、constraint、regex）
- 调用 ConfigGenerationService 分析数据文件并生成配置
- 支持自定义采样行数、列数、生成选项等参数

架构设计:
- 依赖 get_project_config_path 获取项目路径
- 使用 ConfigGenerationService 封装 AI 配置生成逻辑
- 对生成过程中的各类异常进行分层处理

输入示例:
    POST /ai/v2/config/generate
    {
        "file_paths": ["data/users.xlsx"],
        "project_name": "用户数据项目",
        "project_id": "user-data",
        "options": {
            "sample_rows": 100,
            "generate_schemas": true,
            "generate_constraints": true
        }
    }

输出示例:
    {
        "success": true,
        "yaml_preview": "version: 2...",
        "manifest": {...},
        "schemas": {...},
        "constraints": {...},
        "regex_nodes": {},
        "warnings": [],
        "error": null
    }
"""

import logging

from fastapi import Depends, HTTPException

from app.api.dependencies import get_project_config_path
from app.shared.services.llm.generation import (
    CancelledError,
    ConfigGenerationService,
    GenerationOptions,
    GenerationParseError,
    ProfilingOptions,
)

from .models import ConfigGenerateRequest, ConfigGenerateResponse
from .router import router


@router.post(
    "/v2/config/generate",
    response_model=ConfigGenerateResponse,
    summary="同步生成 V2 配置",
    responses={
        400: {"description": "参数错误"},
        409: {"description": "生成任务已取消"},
        422: {"description": "AI 响应解析失败"},
        500: {"description": "服务器内部错误"},
    },
)
async def generate_v2_config(
    payload: ConfigGenerateRequest,
    config_path: str = Depends(get_project_config_path),
) -> ConfigGenerateResponse:
    """
    同步生成 V2 配置

    使用配置的 AI Provider 分析数据文件并生成项目配置。
    包括数据探查（Profiling）和配置生成两个主要阶段。

    Args:
        payload: 配置生成请求，包含文件路径、项目信息和生成选项
        config_path: 项目配置文件路径（由依赖注入提供）

    Returns:
        包含生成结果、YAML 预览和错误信息的响应对象

    Raises:
        HTTPException: 参数错误(400)、AI解析失败(422)、任务取消(409)、服务器错误(500)
    """
    # 构建数据探查选项（控制采样策略）
    profiling_opts = ProfilingOptions(
        sample_rows=payload.options.sample_rows,
        sample_values_per_column=payload.options.sample_values_per_column,
        max_files=payload.options.max_files,
        max_cell_chars=payload.options.max_cell_chars,
    )

    # 构建生成选项（控制输出内容）
    gen_opts = GenerationOptions(
        generate_schemas=payload.options.generate_schemas,
        generate_constraints=payload.options.generate_constraints,
        generate_regex_nodes=payload.options.generate_regex_nodes,
        keep_existing=payload.options.keep_existing,
    )

    # 创建配置生成服务实例（指定使用的 AI Provider）
    service = ConfigGenerationService(provider_id=payload.provider_id)

    try:
        # 调用服务执行配置生成
        result = await service.generate(
            file_paths=payload.file_paths,
            project_name=payload.project_name,
            project_id=payload.project_id,
            config_path=config_path,
            profiling_options=profiling_opts,
            generation_options=gen_opts,
        )
    except ValueError as e:
        # 参数校验失败（如文件不存在、Provider 未配置等）
        raise HTTPException(status_code=400, detail=str(e))
    except GenerationParseError as e:
        # AI 返回的内容无法解析为有效配置
        raise HTTPException(status_code=422, detail=f"AI 响应解析失败: {e}")
    except CancelledError:
        # 生成任务被用户取消
        raise HTTPException(status_code=409, detail="生成任务已取消")
    except Exception:
        # 其他未预期的服务器错误
        logging.getLogger(__name__).exception("Config generation failed")
        raise HTTPException(status_code=500, detail="配置生成失败，请稍后重试")

    # 组装响应对象
    return ConfigGenerateResponse(
        success=result["success"],
        yaml_preview=result["yaml_preview"],
        manifest=result["manifest"],
        schemas=result["schemas"],
        constraints=result["constraints"],
        regex_nodes=result["regex_nodes"],
        warnings=result.get("warnings", []),
        error=result.get("error"),
    )
