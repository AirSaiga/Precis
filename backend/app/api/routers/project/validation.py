"""
@fileoverview 全量校验 API

功能概述:
- 提供项目全量数据校验的 HTTP 入口
- 委托核心逻辑给 ValidationExecutor，与 CLI 共享执行层
- 响应构建下沉到 FullValidationResponseBuilder，保持路由层轻薄

架构设计:
- API 层负责请求校验、参数转换与执行器调用
- ValidationExecutor 负责加载数据、执行格式检查与约束校验
- FullValidationResponseBuilder 负责把执行结果转换为 FullValidationResponse
"""

import logging
import os
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import get_project_config_path
from app.api.services.full_validation_response_builder import FullValidationResponseBuilder
from app.shared.core.io.yaml import read_yaml
from app.shared.core.project.manifest.coverage import compute_manifest_coverage, coverage_to_api_dict
from app.shared.core.project.manifest.types import ProjectManifestV2
from app.shared.services.validation.executor import ValidationExecutor

from ...models import FullValidationRequest, FullValidationResponse
from .base import _v2_manifest_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Project-Validation"])


@router.post(
    "/validate/full",
    response_model=FullValidationResponse,
    summary="执行项目全量数据校验",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Manifest 不存在"},
        501: {"description": "功能暂未实现"},
        500: {"description": "服务器内部错误"},
    },
)
def validate_v2_full(
    request: FullValidationRequest,
    config_path: str = Depends(get_project_config_path),
):
    """
    执行项目全量数据校验。

    参数:
        request: 校验请求，包含可选的配置覆盖
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        FullValidationResponse: 校验结果
    """
    started = time.monotonic()
    logger.info(f"[validate_v2_full] 收到请求，config_path: {config_path}")
    manifest_path = _v2_manifest_path(config_path)
    logger.info(f"[validate_v2_full] manifest_path: {manifest_path}")
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")

    coverage_payload = None
    try:
        manifest_data = read_yaml(Path(manifest_path))
        manifest_model = ProjectManifestV2.model_validate(manifest_data)
        coverage_payload = coverage_to_api_dict(compute_manifest_coverage(config_path, manifest_model))
    except Exception as e:
        logger.warning(f"[validate_v2_full] 计算 coverage 失败: {e}")

    # 初始化执行器
    try:
        override_settings = None
        if request.options and request.options.override_settings:
            override_settings = request.options.override_settings
        executor = ValidationExecutor(manifest_path, override_settings)
    except Exception as e:
        logger.error(f"[validate_v2_full] 初始化执行器失败: {e}")
        return FullValidationResponseBuilder(
            executor=None,
            started=started,
            coverage=coverage_payload,
        ).build_error(e)

    builder = FullValidationResponseBuilder(
        executor=executor,
        started=started,
        coverage=coverage_payload,
    )

    # 确定数据目录
    data_directory = config_path
    if request.options and request.options.data_directory:
        data_directory = request.options.data_directory

    # 校验目标解析
    table_filter = None
    if request.target:
        if request.target.type == "single_file":
            raise HTTPException(status_code=501, detail="当前版本暂不支持单文件全量校验")
        if request.target.type == "single_table":
            table_filter = (request.target.table_id or "").strip()
            if not table_filter:
                raise HTTPException(status_code=400, detail="单表校验缺少 table_id")

    # 执行选项
    validation_settings = executor.settings.validation
    timeout_seconds = int(validation_settings.timeout_seconds or 0)
    if timeout_seconds <= 0:
        timeout_seconds = 30

    from app.shared.services.validation.executor import ValidationOptions

    options = ValidationOptions(
        timeout_seconds=timeout_seconds,
        error_handling=validation_settings.error_handling or "continue",
        strict_mode=validation_settings.strict_mode or False,
        table_filter=table_filter,
        allow_unsafe_eval=request.options.allow_unsafe_eval if request.options else None,
    )

    logger.info(f"[validate_v2_full] 开始执行校验，数据目录: {data_directory}")

    # 执行校验并构建响应
    try:
        result = executor.execute(data_directory, options)
    except Exception as e:
        logger.error(f"[validate_v2_full] 校验执行过程中发生异常: {e}", exc_info=True)
        files_total = len(executor.dataset_schema.tables) if executor.dataset_schema else 0
        return builder.build_error(e, files_total=files_total)

    return builder.build_from_result(result)
