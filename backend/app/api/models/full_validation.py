# backend/app/api/models/full_validation.py
"""
@fileoverview 全量校验响应模型

功能概述:
- 定义全量数据校验相关的 Pydantic 数据模型
- 包含校验请求、选项、摘要、错误项、通过项、统计信息等模型
- 支持校验设置覆盖（验证、文件处理、脚本安全）

输入示例:
    ValidationTaskRequest(
        target=ValidationTaskTarget(type="full_project"),
        run_options=ValidationTaskRunOptions(data_directory="./data")
    )

输出示例:
    FullValidationResponse(
        success=True,
        summary=FullValidationSummary(
            files_total=5, files_loaded=5, tables_loaded=3,
            loading_error_count=0, format_error_count=1,
            constraint_error_count=2, total_error_count=3,
            duration_ms=1250
        ),
        errors=[...],
        statistics=ValidationStatistics(...)
    )
"""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class CoverageRef(BaseModel):
    id: str = Field(..., description="资源 ID")
    path: str = Field(..., description="相对路径")


class CoverageGroup(BaseModel):
    schemas: list[CoverageRef] = Field(default_factory=list, description="Schema 引用列表")
    constraints: list[CoverageRef] = Field(default_factory=list, description="Constraint 引用列表")
    regex_nodes: list[CoverageRef] = Field(default_factory=list, description="RegexNode 引用列表")


class ValidationCoverage(BaseModel):
    is_complete: bool = Field(..., description="校验覆盖是否完整")
    unlisted: CoverageGroup = Field(..., description="目录存在但未入清单的资源")
    dangling: CoverageGroup = Field(..., description="清单引用但磁盘缺失/不可读的资源")


class ValidationSettingsOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auto_validate: Optional[bool] = Field(default=None)
    strict_mode: Optional[bool] = Field(default=None)
    error_handling: Optional[Literal["stop", "continue", "report"]] = Field(default=None)
    timeout_seconds: Optional[int] = Field(default=None, ge=1, le=300)
    batch_max_files: Optional[int] = Field(default=None, ge=1, le=1000)


class FileProcessingSettingsOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_encoding: Optional[Literal["utf-8", "gbk", "auto"]] = Field(default=None)
    csv_delimiter: Optional[str] = Field(default=None)


class ScriptSecuritySettingsOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allow_eval: Optional[bool] = Field(default=None)
    allow_exec: Optional[bool] = Field(default=None)
    sandbox_mode: Optional[bool] = Field(default=None)
    timeout_seconds: Optional[int] = Field(default=None, ge=1, le=60)


class ProjectSettingsOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    validation: Optional[ValidationSettingsOverride] = Field(default=None)
    file_processing: Optional[FileProcessingSettingsOverride] = Field(default=None)
    script_security: Optional[ScriptSecuritySettingsOverride] = Field(default=None)


class ValidationTaskTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["full_project", "single_table", "single_file"] = Field(..., description="校验目标类型")
    table_id: Optional[str] = Field(default=None, description="单表校验时的表 ID")
    file_path: Optional[str] = Field(default=None, description="单文件校验时的文件路径")
    display_name: Optional[str] = Field(default=None, description="前端展示名称")


class ValidationTaskRunOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data_directory: Optional[str] = Field(default=None, description="数据目录（用于解析 relative_file source.path）")
    override_settings: Optional[ProjectSettingsOverride] = Field(
        default=None,
        description="可选：覆盖 project.precis.yaml 中 settings 的部分字段",
    )


class ValidationTaskPreflightOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    save_before_run: bool = Field(default=True, description="执行前是否自动保存项目")
    missing_resources_strategy: Literal["ask", "merge_then_run", "run_directly"] = Field(
        default="ask",
        description="发现未合并资源时的处理策略",
    )


class ValidationTaskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: ValidationTaskTarget = Field(..., description="校验目标")
    run_options: ValidationTaskRunOptions = Field(default_factory=ValidationTaskRunOptions, description="运行参数")
    preflight_options: ValidationTaskPreflightOptions = Field(
        default_factory=ValidationTaskPreflightOptions,
        description="运行前策略",
    )


class FullValidationOptions(BaseModel):
    """
    全量校验选项模型

    配置全量校验的执行参数。

    Attributes:
        data_directory: 数据目录路径（用于解析相对路径的数据源）
        override_settings: 可选的配置覆盖项
    """

    data_directory: Optional[str] = Field(None, description="数据目录（用于解析 relative_file source.path）")
    override_settings: Optional[ProjectSettingsOverride] = Field(
        default=None,
        description="可选：覆盖 project.precis.yaml 中 settings 的部分字段（validation/file_processing/script_security）",
    )


class FullValidationRequest(BaseModel):
    """
    全量校验请求模型

    触发全量数据校验的请求体。

    Attributes:
        target: 校验目标（可选，默认 full_project）
        options: 全量校验选项
    """

    target: Optional[ValidationTaskTarget] = Field(default=None, description="校验目标")
    options: Optional[FullValidationOptions] = Field(default=None, description="全量校验选项")


class FullValidationSummary(BaseModel):
    """
    全量校验摘要模型

    汇总全量校验的统计信息。

    Attributes:
        files_total: 本次解析涉及的源文件总数
        files_loaded: 成功加载的源文件数量
        tables_loaded: 成功加载的数据表数量
        loading_error_count: 加载阶段错误数量
        format_error_count: 格式校验错误数量
        constraint_error_count: 逻辑约束错误数量
        total_error_count: 总错误数量
        duration_ms: 总耗时（毫秒）
    """

    files_total: int = Field(..., description="本次解析涉及的源文件数量")
    files_loaded: int = Field(..., description="成功加载的源文件数量")
    tables_loaded: int = Field(..., description="成功加载的数据表数量")
    loading_error_count: int = Field(..., description="加载阶段错误数量（缺文件/格式不支持/读取失败等）")
    format_error_count: int = Field(..., description="格式校验错误数量（缺列/类型不匹配等）")
    constraint_error_count: int = Field(..., description="逻辑约束错误数量（非空/唯一/外键等）")
    total_error_count: int = Field(..., description="总错误数量")
    duration_ms: int = Field(..., description="总耗时（毫秒）")


class FullValidationErrorItem(BaseModel):
    """
    全量校验错误项模型

    记录全量校验中发现的单个错误详情。

    Attributes:
        stage: 错误发生阶段（preflight/loading/format/constraint）
        error_type: 错误类型标识
        check_type: 检查类型标识（可选）
        message: 错误说明文本
        table: 表名（运行时名称，可选）
        table_id: 表 ID（schema 文件中的 ID，可选）
        column: 列名（可选）
        column_id: 列 ID（可选）
        row_index: 行索引（从 0 开始，可选）
        value: 相关值（可选）
        source_path: 相关源文件路径（可选）
    """

    stage: str = Field(..., description="错误阶段：preflight|loading|format|constraint")
    error_type: str = Field(..., description="错误类型")
    check_type: Optional[str] = Field(default=None, description="检查类型")
    message: str = Field(..., description="错误说明")
    table: Optional[str] = Field(default=None, description="表名（运行时 name）")
    table_id: Optional[str] = Field(default=None, description="表 ID（schema 文件中的 id）")
    column: Optional[str] = Field(default=None, description="列名")
    column_id: Optional[str] = Field(default=None, description="列 ID")
    row_index: Optional[int] = Field(default=None, description="行索引（从0开始）")
    value: Optional[str] = Field(default=None, description="相关值（可选）")
    source_path: Optional[str] = Field(default=None, description="相关源文件路径（可选）")
    source_file: Optional[str] = Field(default=None, description="配置文件内定义的数据源文件名（可选）")
    source_sheet: Optional[str] = Field(default=None, description="配置文件内定义的 Excel Sheet 名（可选）")


class ValidationPassedItem(BaseModel):
    """
    校验通过项模型

    记录全量校验中通过的检查项详情。

    Attributes:
        stage: 检查阶段（loading/format/constraint/regex）
        check_type: 检查类型（如：NotNull, Unique, AllowedValues, Regex等）
        message: 通过说明文本
        table: 表名（运行时名称）
        table_id: 表 ID（schema 文件中的 ID）
        column: 列名
        column_id: 列 ID
        source_path: 相关源文件路径（可选）
    """

    stage: str = Field(..., description="检查阶段：loading|format|constraint|regex")
    check_type: str = Field(..., description="检查类型")
    message: str = Field(..., description="通过说明")
    table: Optional[str] = Field(default=None, description="表名（运行时 name）")
    table_id: Optional[str] = Field(default=None, description="表 ID（schema 文件中的 id）")
    column: Optional[str] = Field(default=None, description="列名")
    column_id: Optional[str] = Field(default=None, description="列 ID")
    source_path: Optional[str] = Field(default=None, description="相关源文件路径（可选）")
    source_file: Optional[str] = Field(default=None, description="配置文件内定义的数据源文件名（可选）")
    source_sheet: Optional[str] = Field(default=None, description="配置文件内定义的 Excel Sheet 名（可选）")


class ValidationStatistics(BaseModel):
    """
    校验统计信息模型

    汇总全量校验的详细统计信息。

    Attributes:
        total_checks: 总检查项数
        passed_count: 通过数量
        failed_count: 失败数量
        pass_rate: 通过率（百分比）
        by_type: 按类型统计（约束/正则/类型等）
        by_table: 按表统计
    """

    total_checks: int = Field(..., description="总检查项数")
    passed_count: int = Field(..., description="通过数量")
    failed_count: int = Field(..., description="失败数量")
    pass_rate: float = Field(..., description="通过率（百分比，0-100）")
    by_type: dict[str, dict[str, int]] = Field(
        default_factory=dict, description="按类型统计，如：{'constraint': {'total': 10, 'passed': 8, 'failed': 2}}"
    )
    by_table: dict[str, dict[str, int]] = Field(
        default_factory=dict, description="按表统计，如：{'users': {'total': 5, 'passed': 4, 'failed': 1}}"
    )


class FullValidationResponse(BaseModel):
    """
    全量校验响应模型

    全量校验接口的标准响应格式。

    Attributes:
        success: 请求是否成功
        summary: 摘要统计信息
        errors: 错误明细列表
        passed_items: 通过项列表
        statistics: 详细统计信息
        error: 致命错误信息（可选）
        warnings: 警告信息列表（可选）
    """

    success: bool = Field(..., description="请求是否成功")
    summary: FullValidationSummary = Field(..., description="摘要统计")
    errors: list[FullValidationErrorItem] = Field(default_factory=list, description="错误明细列表")
    passed_items: list[ValidationPassedItem] = Field(default_factory=list, description="通过项列表")
    statistics: Optional[ValidationStatistics] = Field(default=None, description="详细统计信息")
    error: Optional[str] = Field(default=None, description="致命错误信息（可选）")
    warnings: list[str] = Field(default_factory=list, description="警告信息列表（可选）")
    coverage: Optional[ValidationCoverage] = Field(default=None, description="清单一致性覆盖信息（可选）")
