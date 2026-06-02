"""
@fileoverview 全量校验 API

功能概述:
- 提供项目全量数据校验的 HTTP 入口
- 委托核心逻辑给 ValidationExecutor，与 CLI 共享执行层
- 支持配置覆盖、单表过滤、超时控制与错误处理策略

架构设计:
- API 层负责请求校验、参数转换与响应组装
- ValidationExecutor 负责加载数据、执行格式检查与约束校验
- 返回结果包含错误列表、通过项、统计信息与 coverage 报告

输入示例:
    POST /v2/validate/full (body: FullValidationRequest)

输出示例:
    FullValidationResponse: {
        success, summary, errors, passed_items, statistics, warnings, coverage
    }
"""

import logging
import os
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import get_project_config_path
from app.shared.core.io.yaml import read_yaml
from app.shared.core.project.manifest.coverage import compute_manifest_coverage, coverage_to_api_dict
from app.shared.core.project.manifest.types import ProjectManifestV2
from app.shared.services.validation.executor import ValidationExecutor

from ...models import (
    FullValidationErrorItem,
    FullValidationRequest,
    FullValidationResponse,
    FullValidationSummary,
    ValidationPassedItem,
)
from .base import (
    _v2_manifest_path,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Project-Validation"])


@router.post("/v2/validate/full", response_model=FullValidationResponse)
def validate_v2_full(
    request: FullValidationRequest,
    config_path: str = Depends(get_project_config_path),
):
    """
    执行项目全量数据校验。

    校验流程（分三个阶段）：
    已重构为使用共享的 ValidationExecutor

    配置选项：
    - data_directory: 覆盖默认数据目录
    - override_settings: 覆盖项目设置（如临时修改 timeout）
    - options: 请求选项

    错误处理策略（error_handling）：
    - stop: 遇到错误立即停止，后续文件/约束不再执行
    - continue: 收集所有错误，最终返回完整的错误列表

    参数:
        request: 校验请求，包含可选的配置覆盖
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        FullValidationResponse: 校验结果，包含错误列表和统计信息
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

    # 使用共享执行器进行校验
    try:
        # 创建执行器（支持配置覆盖）
        override_settings = None
        if request.options and request.options.override_settings:
            override_settings = request.options.override_settings

        executor = ValidationExecutor(manifest_path, override_settings)

    except Exception as e:
        logger.error(f"[validate_v2_full] 初始化执行器失败: {e}")
        summary = FullValidationSummary(
            files_total=0,
            files_loaded=0,
            tables_loaded=0,
            loading_error_count=0,
            format_error_count=0,
            constraint_error_count=0,
            total_error_count=0,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        return FullValidationResponse(
            success=False, summary=summary, errors=[], error=str(e), coverage=coverage_payload
        )

    # 确定数据目录
    data_directory = config_path
    if request.options and request.options.data_directory:
        data_directory = request.options.data_directory

    table_filter = None
    if request.target:
        if request.target.type == "single_file":
            raise HTTPException(status_code=501, detail="当前版本暂不支持单文件全量校验")
        if request.target.type == "single_table":
            table_filter = (request.target.table_id or "").strip()
            if not table_filter:
                raise HTTPException(status_code=400, detail="单表校验缺少 table_id")

    # 获取设置
    validation_settings = executor.settings.validation
    timeout_seconds = int(validation_settings.timeout_seconds or 0)
    if timeout_seconds <= 0:
        timeout_seconds = 30

    # 创建执行选项
    from app.shared.services.validation.executor import ValidationOptions

    options = ValidationOptions(
        timeout_seconds=timeout_seconds,
        error_handling=validation_settings.error_handling or "continue",
        strict_mode=validation_settings.strict_mode or False,
        table_filter=table_filter,
    )

    logger.info(f"[validate_v2_full] 开始执行校验，数据目录: {data_directory}")

    # 执行校验
    try:
        result = executor.execute(data_directory, options)
    except Exception as e:
        logger.error(f"[validate_v2_full] 校验执行过程中发生异常: {e}", exc_info=True)
        summary = FullValidationSummary(
            files_total=len(executor.dataset_schema.tables) if executor.dataset_schema else 0,
            files_loaded=0,
            tables_loaded=0,
            loading_error_count=0,
            format_error_count=0,
            constraint_error_count=0,
            total_error_count=0,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        return FullValidationResponse(
            success=False,
            summary=summary,
            errors=[],
            error=f"校验执行失败: {str(e)}",
            coverage=coverage_payload,
        )

    # 构建响应
    errors: list[FullValidationErrorItem] = []

    # 转换加载错误（配置加载 + 数据加载）
    for le in result.get("loading_errors", []):
        # 新的配置加载错误格式包含更多详细信息
        error_type = str(le.get("error_type") or "LoadError")
        message = str(le.get("message") or "")
        suggestion = le.get("suggestion", "")
        le.get("ref_id")
        file_path = le.get("file_path")

        # 如果有建议，添加到消息中
        if suggestion:
            message = f"{message}\n建议: {suggestion}"

        errors.append(
            FullValidationErrorItem(
                stage="loading",
                error_type=error_type,
                check_type="DataLoad",
                message=message,
                table=le.get("table"),
                source_path=file_path,
                source_file=le.get("source_file"),
                source_sheet=le.get("source_sheet"),
            )
        )

    # 转换校验错误
    for err in result.get("errors", []):
        # 跳过超时错误（已在 loading 阶段处理）
        if err.get("error_type") == "Timeout" and any(e.get("error_type") == "Timeout" for e in errors):
            continue
        stage = str(err.get("stage") or "constraint")
        message = str(err.get("message") or err.get("error_message") or "")
        errors.append(
            FullValidationErrorItem(
                stage=stage,
                error_type=str(err.get("error_type") or "ValidationError"),
                check_type=err.get("check_type"),
                message=message,
                table=err.get("table"),
                table_id=err.get("table_id"),
                column=err.get("column"),
                column_id=err.get("column_id"),
                row_index=None if (ri := err.get("row_index")) is None or ri != ri else ri,
                value=str(err.get("value")) if err.get("value") else None,
                source_path=err.get("source_path"),
                source_file=err.get("source_file"),
                source_sheet=err.get("source_sheet"),
            )
        )

    # 统计信息
    loading_error_count = len([e for e in errors if e.stage == "loading"])
    format_error_count = len([e for e in errors if e.stage == "format"])
    constraint_error_count = len([e for e in errors if e.stage == "constraint"])
    total_error_count = len(errors)

    files_loaded = len(set(result.get("raw_datasets", {}).keys()))

    summary = FullValidationSummary(
        files_total=len(executor.dataset_schema.tables),
        files_loaded=files_loaded,
        tables_loaded=len(result.get("raw_datasets", {})),
        loading_error_count=loading_error_count,
        format_error_count=format_error_count,
        constraint_error_count=constraint_error_count,
        total_error_count=total_error_count,
        duration_ms=result.get("duration_ms", 0),
    )

    # 构建通过项列表（用于前端显示校验详情）
    passed_items: list[ValidationPassedItem] = []

    # 构建 ID -> Name 映射（用于显示友好的表名）
    id_to_name = {}
    if executor.dataset_schema and executor.dataset_schema.tables:
        for tid, schema in executor.dataset_schema.tables.items():
            target_name = schema.name or tid
            if schema.id:
                id_to_name[schema.id] = target_name
            id_to_name[tid] = target_name

    # 1. 为每个成功加载的表添加通过项
    for table_id in result.get("raw_datasets", {}).keys():
        table_name = id_to_name.get(table_id, table_id)
        passed_items.append(
            ValidationPassedItem(
                stage="loading",
                check_type="DataLoad",
                message=f"数据表 '{table_name}' 加载成功",
                table=table_name,
                source_file=result.get("raw_datasets", {}).get(table_id, {}).get("source_file"),
                source_sheet=result.get("raw_datasets", {}).get(table_id, {}).get("source_sheet"),
            )
        )

    # 2. 从 validation_details 中提取格式校验通过项
    validation_details = result.get("validation_details", {})
    for format_check in validation_details.get("format_checks", []):
        if format_check.get("passed", False):
            passed_items.append(
                ValidationPassedItem(
                    stage="format",
                    check_type="FormatValidation",
                    message=f"数据表 '{format_check['table']}' 格式校验通过",
                    table=format_check["table"],
                    source_file=format_check.get("source_file"),
                    source_sheet=format_check.get("source_sheet"),
                )
            )

    # 3. 从 validation_details 中提取约束校验通过项
    for constraint_check in validation_details.get("constraint_checks", []):
        constraint_type = constraint_check.get("constraint_type", "Unknown")
        table_name = constraint_check.get("table")
        description = constraint_check.get("description", "")
        passed = constraint_check.get("passed", False)

        # 无论约束是通过还是失败，都记录该约束被执行
        # 通过的约束显示为通过项，失败的约束已经在 errors 中显示
        if passed:
            passed_items.append(
                ValidationPassedItem(
                    stage="constraint",
                    check_type=constraint_type,
                    message=description or f"{constraint_type} 约束校验通过",
                    table=table_name,
                    source_file=constraint_check.get("source_file"),
                    source_sheet=constraint_check.get("source_sheet"),
                )
            )

    # 构建统计信息
    from ...models import ValidationStatistics

    by_type = {}
    by_table = {}

    def _ensure_bucket(container, key):
        target_key = str(key or "Unknown")
        if target_key not in container:
            container[target_key] = {"total": 0, "passed": 0, "failed": 0}
        return container[target_key]

    for item in passed_items:
        type_bucket = _ensure_bucket(by_type, item.check_type)
        type_bucket["total"] += 1
        type_bucket["passed"] += 1
        if item.table:
            table_bucket = _ensure_bucket(by_table, item.table)
            table_bucket["total"] += 1
            table_bucket["passed"] += 1

    for item in errors:
        type_bucket = _ensure_bucket(by_type, item.check_type or item.error_type)
        type_bucket["total"] += 1
        type_bucket["failed"] += 1
        if item.table:
            table_bucket = _ensure_bucket(by_table, item.table)
            table_bucket["total"] += 1
            table_bucket["failed"] += 1

    statistics = ValidationStatistics(
        total_checks=len(passed_items) + len(errors),
        passed_count=len(passed_items),
        failed_count=len(errors),
        pass_rate=(
            100.0
            if (len(passed_items) + len(errors)) == 0
            else (len(passed_items) / (len(passed_items) + len(errors)) * 100)
        ),
        by_type=by_type,
        by_table=by_table,
    )

    return FullValidationResponse(
        success=(total_error_count == 0),
        summary=summary,
        errors=errors,
        passed_items=passed_items,
        statistics=statistics,
        error=None,
        warnings=result.get("warnings", []),
        coverage=coverage_payload,
    )


# 以下是旧的实现，已被 ValidationExecutor 替代
# 旧代码已删除
