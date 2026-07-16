"""
@fileoverview 全量校验响应构建器

功能概述:
- 将 ValidationExecutor 的输出转换为 FullValidationResponse
- 封装错误分类、ID -> Name 映射、通过项构造、统计聚合、覆盖率组装
- 使 API 路由层仅负责参数校验与执行器调用

输入示例:
    builder = FullValidationResponseBuilder(executor, started=time.monotonic(), coverage=coverage)
    response = builder.build_from_result(result)

输出示例:
    FullValidationResponse 实例，包含 success/summary/errors/passed_items/statistics 等字段
"""

from __future__ import annotations

import logging
import time
from typing import Any

from app.api.models import (
    FullValidationErrorItem,
    FullValidationResponse,
    FullValidationSummary,
    ValidationPassedItem,
    ValidationStatistics,
)
from app.shared.services.validation.executor import ValidationExecutor

logger = logging.getLogger(__name__)


class FullValidationResponseBuilder:
    """
    全量校验响应构建器。

    负责把执行器返回的原始结果字典转换为前端需要的 Pydantic 响应模型，
    同时支持执行器初始化失败或执行异常时的降级响应构建。
    """

    def __init__(
        self,
        executor: ValidationExecutor | None,
        started: float,
        coverage: Any | None = None,
    ):
        """
        初始化响应构建器。

        参数:
            executor: 校验执行器实例；初始化失败时可为 None
            started: 路由层记录的起始时间（time.monotonic()）
            coverage: 预计算的覆盖率 payload（可选）
        """
        self.executor = executor
        self.started = started
        self.coverage = coverage

    def _duration_ms(self) -> int:
        """计算从 started 到当前的耗时（毫秒）。"""
        return int((time.monotonic() - self.started) * 1000)

    def _build_id_to_name(self) -> dict[str, str]:
        """构建 Schema ID -> 显示名称 的映射。"""
        id_to_name: dict[str, str] = {}
        if not self.executor or not self.executor.dataset_schema:
            return id_to_name

        for tid, schema in self.executor.dataset_schema.tables.items():
            target_name = schema.name or tid
            if schema.id:
                id_to_name[schema.id] = target_name
            id_to_name[tid] = target_name

        return id_to_name

    def _build_errors(self, result: dict[str, Any]) -> list[FullValidationErrorItem]:
        """将 executor 结果中的 loading_errors 与 errors 转换为响应错误项。"""
        errors: list[FullValidationErrorItem] = []

        # 加载阶段错误
        for le in result.get("loading_errors", []):
            error_type = str(le.get("error_type") or "LoadError")
            message = str(le.get("message") or "")
            suggestion = le.get("suggestion", "")
            if suggestion:
                message = f"{message}\n建议: {suggestion}"

            errors.append(
                FullValidationErrorItem(
                    stage="loading",
                    error_type=error_type,
                    check_type="DataLoad",
                    message=message,
                    table=le.get("table"),
                    source_path=le.get("file_path"),
                    source_file=le.get("source_file"),
                    source_sheet=le.get("source_sheet"),
                )
            )

        # 校验错误
        for err in result.get("errors", []):
            # 跳过重复的超时错误
            if err.get("error_type") == "Timeout" and any(e.error_type == "Timeout" for e in errors):
                continue

            stage = str(err.get("stage") or "constraint")
            message = str(err.get("message") or err.get("error_message") or "")
            row_index_raw = err.get("row_index")
            row_index = None if row_index_raw is None or row_index_raw != row_index_raw else row_index_raw

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
                    row_index=row_index,
                    # 回归 C3: 用 is not None 而非 falsy 判断,避免 value=0/False/"" 被吞成 None,
                    # 妨碍用户定位(如 Range 对值 0 的违规)。
                    value=str(err.get("value")) if err.get("value") is not None else None,
                    source_path=err.get("source_path"),
                    source_file=err.get("source_file"),
                    source_sheet=err.get("source_sheet"),
                )
            )

        return errors

    def _build_passed_items(self, result: dict[str, Any], id_to_name: dict[str, str]) -> list[ValidationPassedItem]:
        """从 executor 结果中构造所有通过项。"""
        passed_items: list[ValidationPassedItem] = []
        raw_datasets = result.get("raw_datasets", {})

        # 1. 成功加载的数据表
        for table_id in raw_datasets.keys():
            table_name = id_to_name.get(table_id, table_id)
            dataset_info = raw_datasets.get(table_id, {})
            source_file = None
            source_sheet = None
            if isinstance(dataset_info, dict):
                source_file = dataset_info.get("source_file")
                source_sheet = dataset_info.get("source_sheet")

            passed_items.append(
                ValidationPassedItem(
                    stage="loading",
                    check_type="DataLoad",
                    message=f"数据表 '{table_name}' 加载成功",
                    table=table_name,
                    source_file=source_file,
                    source_sheet=source_sheet,
                )
            )

        validation_details = result.get("validation_details", {})

        # 2. 格式校验通过项
        for format_check in validation_details.get("format_checks", []):
            if not format_check.get("passed", False):
                continue
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

        # 3. 约束校验通过项
        for constraint_check in validation_details.get("constraint_checks", []):
            if not constraint_check.get("passed", False):
                continue
            constraint_type = constraint_check.get("constraint_type", "Unknown")
            passed_items.append(
                ValidationPassedItem(
                    stage="constraint",
                    check_type=constraint_type,
                    message=constraint_check.get("description", "") or f"{constraint_type} 约束校验通过",
                    table=constraint_check.get("table"),
                    source_file=constraint_check.get("source_file"),
                    source_sheet=constraint_check.get("source_sheet"),
                )
            )

        return passed_items

    def _build_statistics(
        self,
        errors: list[FullValidationErrorItem],
        passed_items: list[ValidationPassedItem],
    ) -> ValidationStatistics:
        """按类型和表聚合统计信息。

        回归 C1: 顶层 total_checks/passed_count/failed_count/pass_rate 必须按"检查项"粒度
        计算(与 passed_items 同粒度),不能分子按项、分母按错误行混算。原实现
        failed_count=len(errors)(行数),导致 1 个约束在 N 行违规 → 通过率≈1/N,即使
        其余检查全过也显示灾难性低通过率,污染历史趋势。
        - 顶层计数:每个不同的 (stage, check_type, table) 失败检查记 1(与通过的检查项同粒度)。
        - by_type/by_table 明细:保留按错误条目计数(便于用户看每类/每表的具体错误规模)。
        """
        by_type: dict[str, dict[str, int]] = {}
        by_table: dict[str, dict[str, int]] = {}

        def _ensure_bucket(container: dict[str, dict[str, int]], key: Any) -> dict[str, int]:
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

        # 收集"失败检查项"的唯一标识(检查项粒度),与 passed_items 对齐。
        # 标识 = (stage, check_type/error_type, table);同一检查在多行违规只算 1 个失败检查。
        failed_check_keys: set[tuple[str, str, str]] = set()
        for error_item in errors:
            check_key = (
                error_item.stage,
                str(error_item.check_type or error_item.error_type or "Unknown"),
                str(error_item.table or ""),
            )
            failed_check_keys.add(check_key)

            type_bucket = _ensure_bucket(by_type, error_item.check_type or error_item.error_type)
            type_bucket["total"] += 1
            type_bucket["failed"] += 1
            if error_item.table:
                table_bucket = _ensure_bucket(by_table, error_item.table)
                table_bucket["total"] += 1
                table_bucket["failed"] += 1

        passed_count = len(passed_items)
        failed_count = len(failed_check_keys)
        total_checks = passed_count + failed_count
        pass_rate = 100.0 if total_checks == 0 else (passed_count / total_checks * 100)

        return ValidationStatistics(
            total_checks=total_checks,
            passed_count=passed_count,
            failed_count=failed_count,
            pass_rate=pass_rate,
            by_type=by_type,
            by_table=by_table,
        )

    def _build_summary(
        self,
        result: dict[str, Any],
        errors: list[FullValidationErrorItem],
    ) -> FullValidationSummary:
        """构造摘要统计。"""
        loading_error_count = len([e for e in errors if e.stage == "loading"])
        format_error_count = len([e for e in errors if e.stage == "format"])
        constraint_error_count = len([e for e in errors if e.stage == "constraint"])

        raw_datasets = result.get("raw_datasets", {})
        files_loaded = len(set(raw_datasets.keys()))

        files_total = 0
        if self.executor and self.executor.dataset_schema:
            files_total = len(self.executor.dataset_schema.tables)

        return FullValidationSummary(
            files_total=files_total,
            files_loaded=files_loaded,
            tables_loaded=len(raw_datasets),
            loading_error_count=loading_error_count,
            format_error_count=format_error_count,
            constraint_error_count=constraint_error_count,
            total_error_count=len(errors),
            duration_ms=result.get("duration_ms", self._duration_ms()),
        )

    def build_from_result(self, result: dict[str, Any]) -> FullValidationResponse:
        """
        基于 executor 成功返回的结果字典构建完整响应。

        参数:
            result: ValidationExecutor.execute 返回的字典

        返回:
            FullValidationResponse 实例
        """
        errors = self._build_errors(result)
        id_to_name = self._build_id_to_name()
        passed_items = self._build_passed_items(result, id_to_name)
        statistics = self._build_statistics(errors, passed_items)
        summary = self._build_summary(result, errors)

        return FullValidationResponse(
            success=(len(errors) == 0),
            summary=summary,
            errors=errors,
            passed_items=passed_items,
            statistics=statistics,
            error=None,
            warnings=result.get("warnings", []),
            coverage=self.coverage,
        )

    def build_error(
        self,
        error: Exception,
        *,
        files_total: int = 0,
    ) -> FullValidationResponse:
        """
        构建执行器初始化失败或执行异常时的降级响应。

        参数:
            error: 异常对象
            files_total: 扫描到的源文件总数

        返回:
            FullValidationResponse 实例（success=False）
        """
        summary = FullValidationSummary(
            files_total=files_total,
            files_loaded=0,
            tables_loaded=0,
            loading_error_count=0,
            format_error_count=0,
            constraint_error_count=0,
            total_error_count=0,
            duration_ms=self._duration_ms(),
        )

        return FullValidationResponse(
            success=False,
            summary=summary,
            errors=[],
            passed_items=[],
            statistics=ValidationStatistics(
                total_checks=0,
                passed_count=0,
                failed_count=0,
                # 回归 #9: 执行失败时 pass_rate 必须为 0.0 而非 100.0。原实现返回 100.0,
                # 与 success=False 矛盾,前端会把崩溃的运行以"满分通过"写入历史趋势,
                # 污染纵向对比(通过率趋势)。失败即 0% 通过。
                pass_rate=0.0,
                by_type={},
                by_table={},
            ),
            error=str(error),
            warnings=[],
            coverage=self.coverage,
        )
