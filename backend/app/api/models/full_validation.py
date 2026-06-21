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

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field


class CoverageRef(BaseModel):
    """
    资源引用模型

    用于在校验覆盖报告中标识单个资源（Schema、Constraint 或 RegexNode）。

    Attributes:
        id: 资源的唯一标识符
        path: 资源文件相对于项目根目录的路径
    """

    id: str = Field(..., description="资源 ID")  # 资源的唯一标识符，对应配置文件中的 id 字段
    path: str = Field(..., description="相对路径")  # 资源文件相对于项目根目录的相对路径


class CoverageGroup(BaseModel):
    """
    资源分组模型

    按资源类型（Schema、Constraint、RegexNode）分组列出引用信息，
    用于描述未入清单或悬空引用的资源集合。

    Attributes:
        schemas: Schema 资源引用列表
        constraints: Constraint 资源引用列表
        regex_nodes: RegexNode 资源引用列表
    """

    schemas: list[CoverageRef] = Field(default_factory=list, description="Schema 引用列表")  # 表结构定义资源列表
    constraints: list[CoverageRef] = Field(default_factory=list, description="Constraint 引用列表")  # 约束规则资源列表
    regex_nodes: list[CoverageRef] = Field(default_factory=list, description="RegexNode 引用列表")  # 正则节点资源列表


class ValidationCoverage(BaseModel):
    """
    校验覆盖一致性模型

    用于报告项目清单（project.precis.yaml）与磁盘实际文件之间的一致性状态。
    帮助用户发现"目录存在但未入清单"或"清单引用但磁盘缺失"的资源问题。

    Attributes:
        is_complete: 覆盖是否完整（无 unlisted 且无 dangling 时为 True）
        unlisted: 磁盘存在但未在 project.precis.yaml 中声明的资源
        dangling: project.precis.yaml 中声明但磁盘缺失或不可读的资源
    """

    is_complete: bool = Field(..., description="校验覆盖是否完整")  # True 表示清单与磁盘完全一致，无遗漏也无悬空引用
    unlisted: CoverageGroup = Field(..., description="目录存在但未入清单的资源")  # 磁盘上存在但未在清单中注册的资源分组
    dangling: CoverageGroup = Field(
        ..., description="清单引用但磁盘缺失/不可读的资源"
    )  # 清单中注册但磁盘上缺失或不可读的资源分组


class ValidationSettingsOverride(BaseModel):
    """
    校验设置覆盖模型

    用于在单次校验任务中临时覆盖 project.precis.yaml 中的校验相关设置。
    所有字段均为可选，未提供的字段保持项目原有配置。

    Attributes:
        auto_validate: 是否开启自动校验
        strict_mode: 是否启用严格模式（遇到首个错误即停止）
        error_handling: 错误处理策略（stop/continue/report）
        timeout_seconds: 单次校验超时时间（秒），范围 1-300
        batch_max_files: 批量处理最大文件数，范围 1-1000
    """

    model_config = ConfigDict(extra="forbid")  # 禁止额外字段，防止传入未定义的配置项

    auto_validate: bool | None = Field(default=None)  # True 表示加载数据后自动执行校验，None 表示使用项目默认配置
    strict_mode: bool | None = Field(default=None)  # True 表示遇到首个错误即停止校验，False 表示继续执行并汇总所有错误
    error_handling: Literal["stop", "continue", "report"] | None = Field(
        default=None
    )  # 错误处理策略：stop（停止）、continue（继续）、report（仅报告）
    timeout_seconds: int | None = Field(default=None, ge=1, le=300)  # 校验任务超时时间（秒），最小 1 秒，最大 300 秒
    batch_max_files: int | None = Field(
        default=None, ge=1, le=1000
    )  # 批量加载文件时的最大文件数量限制，最小 1，最大 1000


class FileProcessingSettingsOverride(BaseModel):
    """
    文件处理设置覆盖模型

    用于在单次校验任务中临时覆盖 project.precis.yaml 中的文件处理相关设置。

    Attributes:
        default_encoding: 默认文件编码（utf-8/gbk/auto）
        csv_delimiter: CSV 文件分隔符（如逗号、分号、制表符）
    """

    model_config = ConfigDict(extra="forbid")  # 禁止额外字段，确保配置严格受控

    default_encoding: Literal["utf-8", "gbk", "auto"] | None = Field(
        default=None
    )  # 文件编码：utf-8、gbk 或自动检测（auto）
    csv_delimiter: str | None = Field(default=None)  # CSV 文件列分隔符，如 "," ";" "\t"，None 表示使用项目默认配置


class ScriptSecuritySettingsOverride(BaseModel):
    """
    脚本安全设置覆盖模型

    用于在单次校验任务中临时覆盖 project.precis.yaml 中的脚本执行安全策略。
    涉及 eval/exec 等危险操作的权限控制。

    Attributes:
        allow_eval: 是否允许执行 eval 表达式
        allow_exec: 是否允许执行 exec 代码块
        sandbox_mode: 是否启用沙箱模式隔离脚本执行环境
        timeout_seconds: 脚本执行超时时间（秒），范围 1-60
    """

    model_config = ConfigDict(extra="forbid")  # 禁止额外字段，防止安全配置被绕过

    allow_eval: bool | None = Field(default=None)  # True 允许在校验中使用 eval 执行动态表达式，存在代码注入风险
    allow_exec: bool | None = Field(default=None)  # True 允许在校验中使用 exec 执行代码块，安全风险较高
    sandbox_mode: bool | None = Field(default=None)  # True 启用沙箱隔离，限制脚本执行环境访问范围
    timeout_seconds: int | None = Field(
        default=None, ge=1, le=60
    )  # 单个脚本执行的最大允许时间（秒），最小 1 秒，最大 60 秒


class ProjectSettingsOverride(BaseModel):
    """
    项目设置覆盖模型

    作为全量校验时所有配置覆盖项的顶层聚合容器，
    包含校验设置、文件处理设置和脚本安全设置三个子模块。

    Attributes:
        validation: 校验执行相关设置的覆盖项
        file_processing: 文件加载与解析相关设置的覆盖项
        script_security: 脚本执行安全策略的覆盖项
    """

    model_config = ConfigDict(extra="forbid")  # 禁止额外字段，保持配置结构清晰

    validation: ValidationSettingsOverride | None = Field(default=None)  # 校验行为设置覆盖，如严格模式、超时等
    file_processing: FileProcessingSettingsOverride | None = Field(default=None)  # 文件处理设置覆盖，如编码、分隔符等
    script_security: ScriptSecuritySettingsOverride | None = Field(default=None)  # 脚本安全策略覆盖，如 eval/exec 权限


class ValidationTaskTarget(BaseModel):
    """
    校验任务目标模型

    定义单次校验任务的作用范围：全项目、单表或单文件。
    根据 type 字段的不同，table_id 或 file_path 可能为必填项。

    Attributes:
        type: 校验目标类型（full_project/single_table/single_file）
        table_id: 单表校验时指定的表 ID（schema 文件中的 id）
        file_path: 单文件校验时指定的数据源文件路径
        display_name: 前端展示用的任务名称（可选，用于任务列表显示）
    """

    model_config = ConfigDict(extra="forbid")  # 禁止额外字段，确保目标定义严格

    type: Literal["full_project", "single_table", "single_file"] = Field(
        ..., description="校验目标类型"
    )  # 校验范围：全项目、单表、单文件
    table_id: str | None = Field(
        default=None, description="单表校验时的表 ID"
    )  # 当 type 为 single_table 时，指定目标表的 ID
    file_path: str | None = Field(
        default=None, description="单文件校验时的文件路径"
    )  # 当 type 为 single_file 时，指定目标文件路径
    display_name: str | None = Field(default=None, description="前端展示名称")  # 任务在前端界面中显示的友好名称，可选


class ValidationTaskRunOptions(BaseModel):
    """
    校验任务运行选项模型

    配置校验任务执行时的运行时参数，如数据目录和配置覆盖。

    Attributes:
        data_directory: 数据根目录路径（用于解析 relative_file 类型的 source.path）
        override_settings: 可选的项目设置覆盖项
    """

    model_config = ConfigDict(extra="forbid")  # 禁止额外字段，防止传入无效运行参数

    data_directory: str | None = Field(
        default=None, description="数据目录（用于解析 relative_file source.path）"
    )  # 数据文件根目录，relative_file 类型的数据源路径基于此解析
    override_settings: ProjectSettingsOverride | None = Field(
        default=None,
        description="可选：覆盖 project.precis.yaml 中 settings 的部分字段",
    )  # 临时覆盖项目配置，仅对本次校验任务生效


class ValidationTaskPreflightOptions(BaseModel):
    """
    校验任务预检选项模型

    定义校验任务执行前的预处理策略，如自动保存和未合并资源处理。

    Attributes:
        save_before_run: 执行校验前是否自动保存当前项目状态
        missing_resources_strategy: 发现未合并资源时的处理策略
    """

    model_config = ConfigDict(extra="forbid")  # 禁止额外字段，保持预检逻辑稳定

    save_before_run: bool = Field(
        default=True, description="执行前是否自动保存项目"
    )  # True 表示在校验执行前自动保存项目配置，避免丢失未保存的更改
    missing_resources_strategy: Literal["ask", "merge_then_run", "run_directly"] = Field(
        default="ask",
        description="发现未合并资源时的处理策略",
    )  # 未合并资源处理策略：ask（询问用户）、merge_then_run（先合并再执行）、run_directly（直接执行忽略未合并资源）


class ValidationTaskRequest(BaseModel):
    """
    校验任务请求模型

    触发全量或定向校验的完整请求体，聚合目标、运行选项和预检策略。

    Attributes:
        target: 校验目标定义（范围、具体表/文件）
        run_options: 运行时参数（数据目录、配置覆盖）
        preflight_options: 执行前预处理策略
    """

    model_config = ConfigDict(extra="forbid")  # 禁止额外字段，确保请求结构清晰可控

    target: ValidationTaskTarget = Field(..., description="校验目标")  # 定义本次校验的作用范围和具体对象，必填
    run_options: ValidationTaskRunOptions = Field(
        default_factory=ValidationTaskRunOptions, description="运行参数"
    )  # 校验执行参数，默认使用空选项（全部使用项目默认配置）
    preflight_options: ValidationTaskPreflightOptions = Field(
        default_factory=ValidationTaskPreflightOptions,
        description="运行前策略",
    )  # 校验前预处理策略，默认自动保存项目并在发现未合并资源时询问用户


class FullValidationOptions(BaseModel):
    """
    全量校验选项模型

    配置全量校验的执行参数。

    Attributes:
        data_directory: 数据目录路径（用于解析相对路径的数据源）
        override_settings: 可选的配置覆盖项
        allow_unsafe_eval: 是否允许执行含 eval 的脚本化约束
    """

    data_directory: str | None = Field(
        None, description="数据目录（用于解析 relative_file source.path）"
    )  # 数据文件根目录，relative_file 类型的数据源路径基于此解析
    override_settings: ProjectSettingsOverride | None = Field(
        default=None,
        description="可选：覆盖 project.precis.yaml 中 settings 的部分字段（validation/file_processing/script_security）",
    )  # 临时覆盖项目配置，仅对本次全量校验任务生效
    allow_unsafe_eval: bool | None = Field(
        default=None,
        description="是否允许执行含 eval 的脚本化约束；None 表示使用项目默认配置",
    )  # True 允许脚本化约束使用 eval，False 强制禁用，None 遵循项目配置


class FullValidationRequest(BaseModel):
    """
    全量校验请求模型

    触发全量数据校验的请求体。

    Attributes:
        target: 校验目标（可选，默认 full_project）
        options: 全量校验选项
    """

    target: ValidationTaskTarget | None = Field(
        default=None, description="校验目标"
    )  # 校验目标定义，None 表示默认校验整个项目
    options: FullValidationOptions | None = Field(
        default=None, description="全量校验选项"
    )  # 校验执行选项，None 表示使用项目默认配置


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

    files_total: int = Field(
        ..., description="本次解析涉及的源文件数量"
    )  # 校验过程中扫描到的所有源文件总数（含成功和失败）
    files_loaded: int = Field(..., description="成功加载的源文件数量")  # 成功读取并解析的源文件数量
    tables_loaded: int = Field(
        ..., description="成功加载的数据表数量"
    )  # 成功构建为内部数据表的 Schema 数量（一个文件可能对应多个表）
    loading_error_count: int = Field(
        ..., description="加载阶段错误数量（缺文件/格式不支持/读取失败等）"
    )  # 数据加载阶段发生的错误数，如文件缺失、格式不支持、读取权限不足等
    format_error_count: int = Field(
        ..., description="格式校验错误数量（缺列/类型不匹配等）"
    )  # 数据格式校验阶段发现的错误数，如缺少必需列、数据类型不匹配等
    constraint_error_count: int = Field(
        ..., description="逻辑约束错误数量（非空/唯一/外键等）"
    )  # 逻辑约束校验阶段发现的错误数，如非空违反、唯一性冲突、外键引用无效等
    total_error_count: int = Field(
        ..., description="总错误数量"
    )  # 所有阶段错误数量的总和（loading + format + constraint）
    duration_ms: int = Field(..., description="总耗时（毫秒）")  # 从校验开始到完成的总耗时，单位为毫秒

    @computed_field
    def error_count(self) -> int:
        """总错误数量（兼容旧 API 字段名）。"""
        return self.total_error_count


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

    stage: str = Field(
        ..., description="错误阶段：preflight|loading|format|constraint"
    )  # 错误发生的阶段：preflight（预检）、loading（加载）、format（格式）、constraint（约束）
    error_type: str = Field(
        ..., description="错误类型"
    )  # 错误的具体类型标识，如 FileNotFound、MissingColumn、NotNullViolation 等
    check_type: str | None = Field(
        default=None, description="检查类型"
    )  # 触发错误的检查类型，如 NotNull、Unique、Range 等，预检/加载阶段可能为空
    message: str = Field(..., description="错误说明")  # 面向用户的错误描述文本，说明错误原因和影响
    table: str | None = Field(
        default=None, description="表名（运行时 name）"
    )  # 错误关联的数据表运行时名称（解析后的名称），可选
    table_id: str | None = Field(
        default=None, description="表 ID（schema 文件中的 id）"
    )  # 错误关联的数据表在 schema 配置文件中的原始 ID，可选
    column: str | None = Field(default=None, description="列名")  # 错误关联的数据列运行时名称，可选
    column_id: str | None = Field(
        default=None, description="列 ID"
    )  # 错误关联的数据列在 schema 配置文件中的原始 ID，可选
    row_index: int | None = Field(
        default=None, description="行索引（从0开始）"
    )  # 错误发生的行索引（数据行，从 0 开始计数），可选
    value: str | None = Field(default=None, description="相关值（可选）")  # 触发错误的单元格原始值或相关数据，可选
    source_path: str | None = Field(
        default=None, description="相关源文件路径（可选）"
    )  # 错误关联的源数据文件绝对路径，可选
    source_file: str | None = Field(
        default=None, description="配置文件内定义的数据源文件名（可选）"
    )  # schema 配置中 source.path 定义的原始文件名，可选
    source_sheet: str | None = Field(
        default=None, description="配置文件内定义的 Excel Sheet 名（可选）"
    )  # schema 配置中 source.sheet 定义的 Excel 工作表名称，可选


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

    stage: str = Field(
        ..., description="检查阶段：loading|format|constraint|regex"
    )  # 检查通过的阶段：loading（加载）、format（格式）、constraint（约束）、regex（正则）
    check_type: str = Field(
        ..., description="检查类型"
    )  # 通过检查的类型标识，如 NotNull、Unique、AllowedValues、Regex 等
    message: str = Field(..., description="通过说明")  # 面向用户的通过说明文本，描述检查内容和结果
    table: str | None = Field(default=None, description="表名（运行时 name）")  # 通过检查关联的数据表运行时名称，可选
    table_id: str | None = Field(
        default=None, description="表 ID（schema 文件中的 id）"
    )  # 通过检查关联的数据表在 schema 配置文件中的原始 ID，可选
    column: str | None = Field(default=None, description="列名")  # 通过检查关联的数据列运行时名称，可选
    column_id: str | None = Field(
        default=None, description="列 ID"
    )  # 通过检查关联的数据列在 schema 配置文件中的原始 ID，可选
    source_path: str | None = Field(
        default=None, description="相关源文件路径（可选）"
    )  # 通过检查关联的源数据文件绝对路径，可选
    source_file: str | None = Field(
        default=None, description="配置文件内定义的数据源文件名（可选）"
    )  # schema 配置中 source.path 定义的原始文件名，可选
    source_sheet: str | None = Field(
        default=None, description="配置文件内定义的 Excel Sheet 名（可选）"
    )  # schema 配置中 source.sheet 定义的 Excel 工作表名称，可选


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

    total_checks: int = Field(..., description="总检查项数")  # 本次校验执行的所有检查项总数（含通过和失败）
    passed_count: int = Field(..., description="通过数量")  # 所有检查项中校验通过的数量
    failed_count: int = Field(..., description="失败数量")  # 所有检查项中校验失败的数量
    pass_rate: float = Field(
        ..., description="通过率（百分比，0-100）"
    )  # 通过率百分比，计算公式：(passed_count / total_checks) * 100，范围 0-100
    by_type: dict[str, dict[str, int]] = Field(
        default_factory=dict, description="按类型统计，如：{'constraint': {'total': 10, 'passed': 8, 'failed': 2}}"
    )  # 按检查类型分组的统计信息，外层 key 为类型（constraint/regex/format），内层包含 total/passed/failed 计数
    by_table: dict[str, dict[str, int]] = Field(
        default_factory=dict, description="按表统计，如：{'users': {'total': 5, 'passed': 4, 'failed': 1}}"
    )  # 按数据表分组的统计信息，外层 key 为表名，内层包含 total/passed/failed 计数


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

    success: bool = Field(
        ..., description="请求是否成功"
    )  # True 表示校验任务成功完成（可能包含错误项），False 表示任务执行失败（如配置错误、异常中断）
    summary: FullValidationSummary = Field(
        ..., description="摘要统计"
    )  # 校验结果的摘要统计信息，包含文件数、错误数、耗时等核心指标
    errors: list[FullValidationErrorItem] = Field(
        default_factory=list, description="错误明细列表"
    )  # 校验过程中发现的所有错误明细列表，按阶段分类
    passed_items: list[ValidationPassedItem] = Field(
        default_factory=list, description="通过项列表"
    )  # 校验通过的所有检查项明细列表，用于展示完整校验覆盖情况
    statistics: ValidationStatistics | None = Field(
        default=None, description="详细统计信息"
    )  # 校验的详细统计信息，包含按类型和按表的分组统计，可选
    error: str | None = Field(
        default=None, description="致命错误信息（可选）"
    )  # 当 success 为 False 时的致命错误描述，如任务启动失败、配置解析异常等
    warnings: list[str] = Field(
        default_factory=list, description="警告信息列表（可选）"
    )  # 校验过程中的非致命警告信息列表，如建议优化项、已自动修复的问题等
    coverage: ValidationCoverage | None = Field(
        default=None, description="清单一致性覆盖信息（可选）"
    )  # 项目清单与磁盘文件的一致性检查结果，可选
