"""@fileoverview AI 动作 Spec Pydantic 模型 — 结构校验单一事实源

用类型系统编码动作 spec 的**结构性**约束（枚举、必填、Range min<=max 等），
取代散落各处的手写 dict.get() + if 校验。

设计原则：
- 只做**结构校验**（不依赖项目运行时状态）：枚举值、字段存在性、参数关系。
- **上下文校验**（表/列/FK 是否存在、类型兼容性）仍留在各 validator 函数——
  它们需要运行时加载的 schema，Pydantic 表达不了。
- 与 registry.py 互补：registry 描述"有哪些动作"，specs 描述"每个动作的 spec 长什么样"。

风格参照 config/models.py（领域 Pydantic 模型，非 API DTO）：
- ConfigDict(extra="ignore") 容忍 LLM 多余字段（不严格 forbid，避免误杀）
- populate_by_name 支持 camelCase（LLM 可能输出各种大小写）
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

# =============================================================================
# 约束参数模型（按约束类型 discriminated union）
# =============================================================================


class RangeParams(BaseModel):
    """Range 约束参数：min/max 至少有一个，且 min<=max（若都提供）。"""

    model_config = ConfigDict(extra="ignore")

    min: float | int | None = Field(default=None, description="范围下限")
    max: float | int | None = Field(default=None, description="范围上限")
    boundary_mode: str | None = Field(default=None, description="边界模式 inclusive/exclusive")

    @model_validator(mode="after")
    def check_min_max(self) -> RangeParams:
        # 至少一个（与现有 validator 行为一致：允许只给 min 或只给 max）
        if self.min is None and self.max is None:
            raise ValueError("Range 约束需要至少提供 min 或 max 参数")
        # 若都提供，校验 min<=max（现有 validator 完全缺失此检查，本模型补上）
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError(f"Range 约束的 min({self.min}) 不能大于 max({self.max})")
        return self


class AllowedValuesParams(BaseModel):
    """AllowedValues 约束参数：allowedValues 必填且非空。"""

    model_config = ConfigDict(extra="ignore")
    allowedValues: list[Any] = Field(..., min_length=1, description="允许的值列表")


class ForeignKeyParams(BaseModel):
    """ForeignKey 约束参数：toTableId + toColumnId 必填。

    注意：目标表/列是否真实存在属上下文校验，仍在 _constraint_validator 处理。
    """

    model_config = ConfigDict(extra="ignore")
    toTableId: str = Field(..., description="外键引用的目标表 ID")
    toColumnId: str = Field(..., description="外键引用的目标列 ID")


class ConditionalParams(BaseModel):
    """Conditional 约束参数：ifConditions 必填。"""

    model_config = ConfigDict(extra="ignore")
    ifConditions: list[dict[str, Any]] = Field(..., min_length=1, description="条件列表")
    thenValue: Any | None = Field(default=None, description="条件成立时的值")


class ScriptedParams(BaseModel):
    """Scripted 约束参数：expression 或 pattern 二选一。"""

    model_config = ConfigDict(extra="ignore")
    expression: str | None = Field(default=None, description="代码表达式")
    pattern: str | None = Field(default=None, description="正则表达式")

    @model_validator(mode="after")
    def check_expression_or_pattern(self) -> ScriptedParams:
        if not self.expression and not self.pattern:
            raise ValueError("Scripted 约束需要提供 expression 或 pattern 参数")
        return self


class DateLogicParams(BaseModel):
    """DateLogic 约束参数：range 模式需同时有起点和终点。"""

    model_config = ConfigDict(extra="ignore")
    logicMode: str | None = Field(default=None)
    compareOp: str | None = Field(default=None)
    referenceDate: str | None = Field(default=None)
    referenceDateEnd: str | None = Field(default=None)
    referenceColumn: str | None = Field(default=None)
    referenceColumnEnd: str | None = Field(default=None)

    @model_validator(mode="after")
    def check_range_pairs(self) -> DateLogicParams:
        if self.logicMode == "compare" and self.compareOp == "range":
            has_date_pair = self.referenceDate and self.referenceDateEnd
            has_col_pair = self.referenceColumn and self.referenceColumnEnd
            if not (has_date_pair or has_col_pair):
                raise ValueError(
                    "DateLogic range 模式需要同时提供起点和终点"
                    "（referenceDate+referenceDateEnd 或 referenceColumn+referenceColumnEnd）"
                )
        return self


class EmptyParams(BaseModel):
    """无参数约束（NotNull/Unique/Charset/Composite）的空参数模型。"""

    model_config = ConfigDict(extra="ignore")


# 按约束类型名（标准 PascalCase）路由到对应参数模型。
# 别名（NOT_NULL 等）在解析前由 CONSTRAINT_TYPE_ALIASES 归一化。
CONSTRAINT_PARAMS_MODELS: dict[str, type[BaseModel]] = {
    "NotNull": EmptyParams,
    "Unique": EmptyParams,
    "Charset": EmptyParams,
    "Composite": EmptyParams,
    "Range": RangeParams,
    "AllowedValues": AllowedValuesParams,
    "ForeignKey": ForeignKeyParams,
    "Conditional": ConditionalParams,
    "Scripted": ScriptedParams,
    "DateLogic": DateLogicParams,
}


# =============================================================================
# 各动作 Spec 模型
# =============================================================================


class ConstraintSpec(BaseModel):
    """约束动作的 spec（constraintSpec）。ADD/UPDATE/DELETE_CONSTRAINT_NODE 用。"""

    model_config = ConfigDict(extra="ignore")

    # type 设为可选（非 ...）：缺失 type 时 validator 用 missing_constraint_type 报错（有建议提示），
    # 而非被 Pydantic 拦截为 spec_structure_invalid（无建议）。
    type: str | None = Field(default=None, description="约束类型（标准名或别名）")
    tableName: str | None = Field(default=None, description="目标表名")
    targetNodeId: str | None = Field(default=None, description="目标表 ID")
    targetColumn: str | None = Field(default=None, description="目标列名")
    targetColumnId: str | None = Field(default=None, description="目标列 ID")
    constraintId: str | None = Field(default=None, description="约束 ID")
    isInline: bool = Field(default=True, description="是否内联约束")
    params: dict[str, Any] | None = Field(default=None, description="约束参数")

    # 注意：约束类型白名单、表信息存在性、参数完整性均不在 Pydantic 层校验——这些由
    # _constraint_validator 负责（它有更精准的 "did you mean" 建议和 missing_required_param 错误类型）。
    # Pydantic 参数模型（RangeParams 等）仅作为 validate_constraint_params_model 函数供 validator
    # 选择性调用，不在此处自动触发，避免与 validator 的参数检查冲突。
    # Pydantic 层对 ConstraintSpec 只做字段类型解析。


class ValidateSpec(BaseModel):
    """VALIDATE_PROJECT 的 spec（复用 constraintSpec 字段，但 type 可选、表信息可选）。

    与 ConstraintSpec 区别：VALIDATE_PROJECT 可空壳（校验全部表），或只给 tableName。
    """

    model_config = ConfigDict(extra="ignore")
    tableName: str | None = Field(default=None, description="目标表名（可选）")
    targetNodeId: str | None = Field(default=None, description="目标表 ID（可选）")
    tables: list[str] | None = Field(default=None, description="多表校验列表")
    tableIds: list[str] | None = Field(default=None, description="多表校验列表（别名）")


class SchemaColumnSpec(BaseModel):
    """Schema 列定义。"""

    model_config = ConfigDict(extra="ignore")
    name: str = Field(..., description="列名")
    type: str = Field(default="string", description="数据类型")


class SchemaSpec(BaseModel):
    """Schema 动作的 spec（schemaSpec）。"""

    model_config = ConfigDict(extra="ignore")
    name: str | None = Field(default=None, description="表名")
    schemaId: str | None = Field(default=None, description="表 ID")
    columns: list[SchemaColumnSpec] | None = Field(default=None, description="列定义")


class RegexSpec(BaseModel):
    """Regex 动作的 spec（regexSpec）。"""

    model_config = ConfigDict(extra="ignore")
    name: str | None = Field(default=None, description="正则节点名")
    regexId: str | None = Field(default=None, description="正则节点 ID")
    pattern: str | None = Field(default=None, description="正则表达式")
    matchMode: str | None = Field(default="full", description="匹配模式 full/partial/extract")


class TransformSpec(BaseModel):
    """Transform 动作的 spec（transformSpec）。

    注意：转换类型白名单不在 Pydantic 层校验——由 _transform_validator 负责（有建议）。
    Pydantic 此处仅做字段类型与结构解析。
    """

    model_config = ConfigDict(extra="ignore")
    type: str | None = Field(default=None, description="转换类型")
    transformId: str | None = Field(default=None, description="转换节点 ID")
    inputColumn: str | None = Field(default=None, description="输入列")
    params: dict[str, Any] | None = Field(default=None, description="转换参数")
    outputColumns: list[str] | None = Field(default=None, description="输出列")


class SettingsSpec(BaseModel):
    """Settings 动作的 spec（settingsSpec）。

    注意：设置分类白名单不在 Pydantic 层校验——由 _settings_validator 负责（有建议）。
    """

    model_config = ConfigDict(extra="ignore")
    category: str = Field(..., description="设置分类")
    settings: dict[str, Any] = Field(..., description="设置键值")


class CanvasSpec(BaseModel):
    """ADD_TO_CANVAS 动作的 spec（canvasSpec）。

    注意：资源类型白名单与存在性不在 Pydantic 层校验——由 _canvas_validator 负责
    （查磁盘资源是否真实存在）。Pydantic 此处仅做字段结构解析。
    """

    model_config = ConfigDict(extra="ignore")
    resourceKind: str = Field(..., description="资源类型 schema/regex/constraint/transform")
    resourceId: str | None = Field(default=None, description="资源 ID")
    resourceName: str | None = Field(default=None, description="资源名（兜底匹配）")
    name: str | None = Field(default=None, description="资源名（别名）")


# =============================================================================
# 统一解析入口（适配层）
# =============================================================================


# actionType → spec 模型类的映射（从 registry 的 SPEC_FIELD_FOR 派生）
_SPEC_MODEL_FOR: dict[str, type[BaseModel]] = {
    "ADD_CONSTRAINT_NODE": ConstraintSpec,
    "UPDATE_CONSTRAINT_NODE": ConstraintSpec,
    "DELETE_CONSTRAINT_NODE": ConstraintSpec,
    "VALIDATE_PROJECT": ValidateSpec,  # VALIDATE_PROJECT 的 constraintSpec 字段更宽松（type 可选）
    "ADD_SCHEMA": SchemaSpec,
    "UPDATE_SCHEMA": SchemaSpec,
    "DELETE_SCHEMA": SchemaSpec,
    "ADD_REGEX": RegexSpec,
    "UPDATE_REGEX": RegexSpec,
    "DELETE_REGEX": RegexSpec,
    "ADD_TRANSFORM": TransformSpec,
    "UPDATE_TRANSFORM": TransformSpec,
    "DELETE_TRANSFORM": TransformSpec,
    "UPDATE_SETTINGS": SettingsSpec,
    "ADD_TO_CANVAS": CanvasSpec,
}


class SpecParseError(Exception):
    """Spec 结构校验失败。message 含人类可读的错误描述。"""

    def __init__(self, message: str, errors: list[str] | None = None):
        super().__init__(message)
        self.message = message
        self.errors = errors or [message]


def parse_action_spec(action: dict[str, Any]) -> BaseModel:
    """解析动作的 spec 字段并做**结构校验**。

    根据 actionType 从 registry 查 spec 字段名，取出 spec dict，
    用对应 Pydantic 模型校验。校验失败抛 SpecParseError（含全部错误列表）。

    本函数只做结构校验；上下文校验（表/列/FK 是否存在）仍由各 validator 负责。

    参数:
        action: 动作字典，含 actionType 和对应 spec 字段

    返回:
        校验通过的 spec 模型实例

    抛出:
        SpecParseError: 结构校验失败（枚举非法、必填缺失、Range min>max 等）
    """
    from app.shared.services.llm.actions.registry import SPEC_FIELD_FOR

    action_type = action.get("actionType", "")
    spec_field = SPEC_FIELD_FOR.get(action_type)
    model_cls = _SPEC_MODEL_FOR.get(action_type)

    # 无 spec 字段要求的动作（理论上目前所有动作都有 spec，此分支为防御）
    if spec_field is None or model_cls is None:
        return EmptyParams()  # 返回空模型占位

    spec_data = action.get(spec_field)
    if spec_data is None:
        # spec 缺失：对于 VALIDATE_PROJECT 是合法的（可空壳），其余视为结构错误
        if action_type == "VALIDATE_PROJECT":
            return EmptyParams()
        raise SpecParseError(f"动作 {action_type} 缺少 {spec_field} 字段")

    if not isinstance(spec_data, dict):
        raise SpecParseError(f"{spec_field} 必须是对象，实际为 {type(spec_data).__name__}")

    try:
        return model_cls.model_validate(spec_data)
    except Exception as e:  # noqa: BLE001  Pydantic ValidationError 及子类
        # 提取 Pydantic 的字段级错误信息
        if isinstance(e, ValidationError):
            messages = [f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()]
        else:
            messages = [str(e)]
        raise SpecParseError(f"{spec_field} 校验失败: {'; '.join(messages)}", messages) from e


def validate_constraint_params_model(constraint_type: str, params: dict[str, Any]) -> list[str]:
    """用 Pydantic 模型校验约束参数，返回错误消息列表（空列表=通过）。

    供 _constraint_validator 调用，替代原 validate_constraint_params 的结构校验部分。
    别名（NOT_NULL 等）需在调用前归一化为标准名。

    参数:
        constraint_type: 标准约束类型名（PascalCase）
        params: 约束参数 dict

    返回:
        错误消息列表；空列表表示通过
    """
    model_cls = CONSTRAINT_PARAMS_MODELS.get(constraint_type)
    if model_cls is None:
        return []  # 未知类型由上层白名单校验拦截，此处不重复报错
    try:
        model_cls.model_validate(params or {})
        return []
    except ValidationError as e:
        return [err["msg"] for err in e.errors()]
    except Exception as e:  # noqa: BLE001  model_validator 抛 ValueError 等
        return [str(e)]
