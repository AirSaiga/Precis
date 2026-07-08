# backend/app/cli/tui/services/validation_service.py
"""
@fileoverview TUI 校验服务（P1）

功能概述:
- 为 TUI 校验屏提供后端逻辑薄包装：接收清单/数据目录等输入，调用核心
  ``ValidationExecutor`` 执行校验，返回结构化的 ``ValidationResult``。
- 不持有任何 UI 引用，便于在 mock 掉 ``ValidationExecutor`` 边界后独立单测。

架构设计:
- 参数构建逻辑与 CLI 的 ``validate.py:_run_validation`` 完全一致，确保
  CLI 与 TUI 校验行为同源（超时默认 30s、allow_unsafe_eval 三段式回退）。
- 仅做薄包装：核心编排仍在 app.shared.services.validation.executor。
- 临时抑制 config_inspector logger 的 stderr 噪声（与 validate.py 同策略），
  结构化的 loading_errors 已经由 service 透传给 UI 展示。

接口契约（P1 冻结）:
    @dataclass ValidationResult:
        errors, loading_errors, duration_ms, validation_details, raw_datasets
    class ValidationService:
        validate(manifest_path, data_dir, table=None,
                 validation_settings=None, script_security=None) -> ValidationResult
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.shared.services.validation.progress import ProgressEvent


@dataclass
class ValidationResult:
    """TUI 校验结果数据载体。

    字段与 ``ValidationExecutor.execute`` 返回字典的关键字段一一对应，
    但以强类型 dataclass 暴露给 UI 层，避免 UI 直接依赖 executor 的 dict 形状。

    Attributes:
        errors: 校验错误列表（每项为含 error_type/table/column/row_index/message 等键的 dict）。
        loading_errors: 加载阶段警告列表（每项为 LoadingError.to_dict()，含 title/description/fix_hint）。
        duration_ms: 校验总耗时（毫秒）。
        validation_details: 校验明细，含 format_checks / constraint_checks 两个列表。
        raw_datasets: 原始数据集字典（表名 -> DataFrame），用于统计行数；可能为空 dict。
    """

    errors: list[dict[str, Any]] = field(default_factory=list)
    loading_errors: list[dict[str, Any]] = field(default_factory=list)
    duration_ms: int = 0
    validation_details: dict[str, Any] | None = None
    raw_datasets: dict[str, Any] | None = None

    @property
    def has_errors(self) -> bool:
        """是否存在校验错误（用于 UI 决定表格/通过提示的展示）。"""
        return bool(self.errors)


class ValidationService:
    """TUI 校验服务。

    封装 ``ValidationExecutor`` 的调用细节（选项构建、logger 抑制、结果归一化），
    对外暴露单一 ``validate`` 方法。无状态，可被多个屏共享实例化。
    """

    def validate(
        self,
        manifest_path: str,
        data_dir: str,
        table: str | None = None,
        validation_settings: dict[str, Any] | None = None,
        script_security: dict[str, Any] | None = None,
        progress_callback: Callable[[ProgressEvent], None] | None = None,
    ) -> ValidationResult:
        """执行数据校验并返回结构化结果。

        参数构建逻辑与 CLI ``validate.py:_run_validation`` 保持一致：
        - timeout_seconds 取自 validation_settings，缺失或非正时回退 30。
        - allow_unsafe_eval：显式 allow_eval/allow_exec 任一存在时取其或值；
          两者均缺失时传 None（交由 executor 按项目配置解析）。

        Args:
            manifest_path: 项目清单文件绝对路径（project.precis.yaml）。
            data_dir: 数据文件所在目录绝对路径。
            table: 可选的表名过滤，仅校验该表相关约束；None 表示校验全部。
            validation_settings: 校验设置字典（来自项目配置 validation 段），可为 None。
            script_security: 脚本安全设置字典（来自项目配置 script_security 段），可为 None。
            progress_callback: 可选进度回调，透传给 executor；不传时行为完全不变。
                callback 是旁路通道，不影响 ValidationResult（异常由 executor 内部吞掉）。

        Returns:
            ValidationResult：包含错误、加载警告、耗时与校验明细。

        Raises:
            FileNotFoundError: 清单文件不存在时（由 ValidationExecutor 构造抛出）。
            Exception: 校验过程中发生的其它异常原样上抛，由 UI 层捕获并以通知展示。
        """
        validation_settings = validation_settings or {}
        script_security = script_security or {}

        # 临时抑制 config_inspector logger 的 stderr 噪声（与 validate.py 同策略）。
        # 这些问题的详情已通过 loading_errors 结构化返回，日志行属重复噪声。
        inspector_logger = logging.getLogger("app.shared.core.project.loader.loader_parts.config_inspector")
        prev_level = inspector_logger.level
        inspector_logger.setLevel(logging.ERROR)

        try:
            from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

            # 超时：显式配置 > 默认 30；非正值回退 30（与 CLI 一致）
            timeout_seconds = int(validation_settings.get("timeout_seconds", 30))
            if timeout_seconds <= 0:
                timeout_seconds = 30

            # 脚本执行权限：显式传入时优先使用传入值，否则传 None 交由 executor 解析项目配置
            allow_eval = script_security.get("allow_eval")
            allow_exec = script_security.get("allow_exec")
            if allow_eval is None and allow_exec is None:
                allow_unsafe_eval: bool | None = None
            else:
                allow_unsafe_eval = bool(allow_eval or allow_exec)

            options = ValidationOptions(
                timeout_seconds=timeout_seconds,
                allow_unsafe_eval=allow_unsafe_eval,
                table_filter=table,
            )

            executor = ValidationExecutor(manifest_path)
            # 仅在调用方传入 callback 时才透传，保持不传时调用签名与历史完全一致
            # （零回归：避免给不接受该参数的旧式 executor 实现造成 TypeError）。
            if progress_callback is None:
                result = executor.execute(data_dir, options)
            else:
                result = executor.execute(data_dir, options, progress_callback=progress_callback)

            return ValidationResult(
                errors=list(result.get("errors", [])),
                loading_errors=list(result.get("loading_errors", [])),
                duration_ms=int(result.get("duration_ms", 0)),
                validation_details=result.get("validation_details"),
                raw_datasets=result.get("raw_datasets"),
            )
        finally:
            inspector_logger.setLevel(prev_level)


__all__ = ["ValidationResult", "ValidationService"]
