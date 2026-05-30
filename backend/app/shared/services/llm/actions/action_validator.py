"""
@fileoverview 动作预验证器模块

功能概述:
- 在 AI 生成的动作执行前进行业务逻辑验证
- 提前发现表/字段不存在、约束类型不支持、参数缺失等问题
- 避免执行时失败，提升用户体验
- 支持错误分级：errors（阻止执行）和 warnings（提醒但不阻止）

架构设计:
- 与项目结构联动：加载 schemas 目录下的 YAML 文件构建表/字段索引
- 约束类型白名单：VALID_CONSTRAINT_TYPES 定义支持的约束类型
- 参数完整性检查：CONSTRAINT_REQUIRED_PARAMS 定义各类型必填参数
- 返回结构化结果：ValidationResult 包含 errors、warnings、valid_actions

输入示例:
    actions = [
        {
            "action": "create_constraint",
            "tableName": "users",
            "constraintType": "Unique",
            "columnNames": ["email"]
        }
    ]
    validator = ActionValidator("/path/to/project")
    result = validator.validate(actions)

输出示例:
    ValidationResult(
        errors=[ValidationError(action_index=0, action_type="create_constraint",
                                error_type="column_not_found", message="字段 email 不存在")],
        warnings=[],
        valid_actions=[],
        invalid_action_indices={0}
    )
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

from app.shared.services.llm.suggestion_utils import (
    normalize_constraint_type,
    suggest_constraints_for_type,
    suggest_similar_column,
    suggest_similar_constraint_type,
    suggest_similar_table,
)


@dataclass
class ValidationError:
    """验证错误信息

    Attributes:
        action_index: 动作在列表中的索引
        action_type: 动作类型
        error_type: 错误类型标识
        message: 错误描述
        suggestion: 修正建议（可选）
        auto_fixable: 是否可以自动修正
    """

    action_index: int
    action_type: str
    error_type: str  # 'table_not_found', 'column_not_found', 'invalid_constraint_type', etc.
    message: str
    suggestion: str | None = None
    auto_fixable: bool = False


@dataclass
class ValidationResult:
    """验证结果

    Attributes:
        errors: 错误列表（阻止执行）
        warnings: 警告列表（不阻止执行）
        valid_actions: 有效的动作列表
        invalid_action_indices: 无效的动作索引集合
    """

    errors: list[ValidationError] = field(default_factory=list)
    warnings: list[ValidationError] = field(default_factory=list)
    valid_actions: list[dict[str, Any]] = field(default_factory=list)
    invalid_action_indices: set[int] = field(default_factory=set)

    @property
    def has_errors(self) -> bool:
        """是否有错误"""
        return len(self.errors) > 0

    @property
    def has_warnings(self) -> bool:
        """是否有警告"""
        return len(self.warnings) > 0

    @property
    def all_valid(self) -> bool:
        """是否全部有效"""
        return len(self.errors) == 0 and len(self.invalid_action_indices) == 0

    @property
    def partial_valid(self) -> bool:
        """是否部分有效（有错误但也有有效动作）"""
        return len(self.errors) > 0 and len(self.valid_actions) > 0


class ActionValidator:
    """
    @classdesc 动作预验证器

    验证 AI 生成的动作在执行前的业务逻辑可行性。
    加载项目 schema，检查表/字段存在性、约束类型有效性、参数完整性等。

    Attributes:
        project_path: 项目路径
        _project_schema: 缓存的项目结构信息
    """

    # 支持的约束类型
    VALID_CONSTRAINT_TYPES = {
        "NotNull",
        "Unique",
        "Range",
        "AllowedValues",
        "ForeignKey",
        "Conditional",
        "Scripted",
        "DateLogic",
        "Charset",
        "Composite",
        # 别名兼容
        "NOT_NULL",
        "UNIQUE",
        "RANGE",
        "ALLOWED_VALUES",
        "FOREIGN_KEY",
        "CONDITIONAL",
        "DATE_LOGIC",
        "CHARSET",
        "COMPOSITE",
        "REGEX",
    }

    VALID_SCHEMA_TYPES = {"ADD_SCHEMA", "UPDATE_SCHEMA", "DELETE_SCHEMA"}
    VALID_REGEX_TYPES = {"ADD_REGEX", "UPDATE_REGEX", "DELETE_REGEX"}
    VALID_TRANSFORM_TYPES = {"ADD_TRANSFORM", "UPDATE_TRANSFORM", "DELETE_TRANSFORM"}

    VALID_TRANSFORM_TYPE_NAMES = {
        "StringSplit",
        "RegexExtract",
        "MathExpr",
        "DateFormat",
        "Lookup",
        "Strip",
        "UpperCase",
        "LowerCase",
        "Replace",
        "FilterRows",
        "FillNA",
        "DropDuplicates",
        "CastType",
        "Concat",
        "Substring",
        "Aggregate",
        "ConditionalAssign",
        "SortRows",
        "Digits",
        "WeightedSum",
        "Modulo",
        "MapValue",
    }

    VALID_SETTINGS_CATEGORIES = {"validation", "fileProcessing", "scriptSecurity"}

    VALID_DATA_TYPES = {"string", "integer", "decimal", "boolean", "datetime", "date", "time", "float"}

    # 需要特定参数的约束类型
    CONSTRAINT_REQUIRED_PARAMS = {
        "Range": ["min", "max"],  # 至少需要一个
        "AllowedValues": ["allowedValues"],
        "ForeignKey": ["toTableId", "toColumnId"],
    }

    def __init__(self, project_path: str):
        """
        @methoddesc 初始化动作预验证器

        参数:
            project_path: 项目路径
        """
        self.project_path = Path(project_path)
        self._project_schema: dict[str, Any] | None = None

    def _load_project_schema(self) -> dict[str, Any]:
        """
        @methoddesc 加载项目结构信息

        读取 schemas 目录下的 YAML 文件，构建表和字段索引。
        结果会被缓存，避免重复读取。

        返回:
            项目结构字典，包含所有表和字段信息
        """
        if self._project_schema is not None:
            return self._project_schema

        schema = {
            "tables": {},  # table_id -> {name, columns}
            "table_name_to_id": {},  # table_name -> table_id
        }

        schemas_dir = self.project_path / "schemas"
        if not schemas_dir.exists():
            logger.warning(f"Schemas 目录不存在: {schemas_dir}")
            self._project_schema = schema
            return schema

        try:
            import yaml

            for schema_file in schemas_dir.glob("*.yaml"):
                try:
                    with open(schema_file, encoding="utf-8") as f:
                        data = yaml.safe_load(f) or {}

                    table_id = data.get("id", "")
                    table_name = data.get("name", "")
                    columns = data.get("columns", [])

                    if table_id:
                        column_info = {}
                        for col in columns:
                            col_id = col.get("id", col.get("name", ""))
                            col_name = col.get("name", col_id)
                            col_type = col.get("type", "string")
                            if col_id:
                                column_info[col_id] = {
                                    "name": col_name,
                                    "type": col_type,
                                }

                        schema["tables"][table_id] = {
                            "name": table_name,
                            "columns": column_info,
                        }

                        # 建立表名映射
                        if table_name:
                            if table_name not in schema["table_name_to_id"]:
                                schema["table_name_to_id"][table_name] = []
                            schema["table_name_to_id"][table_name].append(table_id)

                except Exception as e:
                    logger.debug(f"读取 schema 文件失败 {schema_file}: {e}")

        except Exception as e:
            logger.error(f"加载项目 schema 失败: {e}")

        self._project_schema = schema
        return schema

    def validate(self, actions: list[dict[str, Any]]) -> ValidationResult:
        """
        @methoddesc 验证动作列表

        遍历所有动作，根据动作类型调用对应的验证方法，
        收集错误、警告和有效动作。

        参数:
            actions: AI 生成的动作列表

        返回:
            验证结果，包含错误、警告和有效动作
        """
        result = ValidationResult()
        schema = self._load_project_schema()

        for index, action in enumerate(actions):
            action_type = action.get("actionType", "")

            if action_type in ["ADD_CONSTRAINT_NODE", "UPDATE_CONSTRAINT_NODE", "DELETE_CONSTRAINT_NODE"]:
                errors = self._validate_constraint_action(action, schema, index)
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            elif action_type == "VALIDATE_PROJECT":
                errors = self._validate_validate_action(action, schema, index)
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            elif action_type in self.VALID_SCHEMA_TYPES:
                errors = self._validate_schema_action(action, index)
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            elif action_type in self.VALID_REGEX_TYPES:
                errors = self._validate_regex_action(action, index)
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            elif action_type in self.VALID_TRANSFORM_TYPES:
                errors = self._validate_transform_action(action, index)
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            elif action_type == "UPDATE_SETTINGS":
                errors = self._validate_settings_action(action, index)
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            else:
                result.warnings.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="unknown_action_type",
                        message=f"未知的动作类型: {action_type}",
                        suggestion="系统可能不支持此操作，请检查 AI 响应",
                    )
                )
                result.valid_actions.append(action)

        return result

    def _validate_constraint_action(
        self, action: dict[str, Any], schema: dict[str, Any], index: int
    ) -> list[ValidationError]:
        """
        @methoddesc 验证约束操作

        检查约束动作中的表、字段、约束类型和参数是否合法。

        参数:
            action: 动作字典
            schema: 项目结构
            index: 动作索引

        返回:
            错误列表
        """
        errors = []
        action_type = action.get("actionType", "")
        spec = action.get("constraintSpec", {})

        # 1. 验证表存在
        table_id = spec.get("targetNodeId")
        table_name = spec.get("tableName")

        if not table_id and not table_name:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="missing_table",
                    message="动作缺少表信息（targetNodeId 或 tableName）",
                    suggestion="请指定要操作的表",
                )
            )
            return errors

        # 检查表是否存在
        table_info = None
        if table_id and table_id in schema["tables"]:
            table_info = schema["tables"][table_id]
        elif table_name:
            # 通过表名查找
            table_ids = schema["table_name_to_id"].get(table_name, [])
            if len(table_ids) == 1:
                table_info = schema["tables"].get(table_ids[0])
            elif len(table_ids) > 1:
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="ambiguous_table_name",
                        message=f"表名 '{table_name}' 匹配到多个表",
                        suggestion=f"请使用表ID，可匹配的表: {', '.join(table_ids[:3])}...",
                    )
                )
                return errors

        if not table_info:
            # 表不存在，尝试提供相似表名建议
            suggestion = suggest_similar_table(table_name or table_id, schema)
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="table_not_found",
                    message=f"表 '{table_name or table_id}' 不存在",
                    suggestion=suggestion,
                    auto_fixable=False,
                )
            )
            return errors

        # 2. 验证字段存在
        column_name = spec.get("targetColumn")
        if not column_name:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="missing_column",
                    message="动作缺少字段信息（targetColumn）",
                    suggestion="请指定要操作的字段",
                )
            )
            return errors

        column_info = None
        for col_id, col_data in table_info["columns"].items():
            if col_id == column_name or col_data["name"] == column_name:
                column_info = col_data
                column_info["id"] = col_id
                break

        if not column_info:
            # 字段不存在，提供相似字段建议
            suggestion = suggest_similar_column(column_name, table_info)
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="column_not_found",
                    message=f"字段 '{column_name}' 在表 '{table_info['name']}' 中不存在",
                    suggestion=suggestion,
                    auto_fixable=False,
                )
            )
            return errors

        # 3. 验证约束类型（ADD 和 UPDATE 需要）
        constraint_type = spec.get("type")
        if action_type in ["ADD_CONSTRAINT_NODE", "UPDATE_CONSTRAINT_NODE"]:
            if not constraint_type:
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="missing_constraint_type",
                        message="动作缺少约束类型（type）",
                        suggestion="请指定约束类型，如: NotNull, Unique, Range 等",
                    )
                )
                return errors

            # 标准化约束类型名
            normalized_type = normalize_constraint_type(constraint_type)
            if normalized_type not in {
                "NotNull",
                "Unique",
                "Range",
                "AllowedValues",
                "ForeignKey",
                "Conditional",
                "Scripted",
                "DateLogic",
                "NOT_NULL",
                "UNIQUE",
                "RANGE",
                "ALLOWED_VALUES",
                "FOREIGN_KEY",
                "CONDITIONAL",
                "DATE_LOGIC",
                "REGEX",
            }:
                suggestion = suggest_similar_constraint_type(constraint_type)
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="invalid_constraint_type",
                        message=f"不支持的约束类型: '{constraint_type}'",
                        suggestion=suggestion,
                        auto_fixable=False,
                    )
                )
                return errors

            # 4. 验证约束参数完整性
            param_errors = self._validate_constraint_params(normalized_type, spec, index, action_type)
            errors.extend(param_errors)

            # 5. 验证字段类型与约束类型兼容性
            if column_info and not param_errors:
                compat_errors = self._validate_type_compatibility(column_info, normalized_type, index, action_type)
                errors.extend(compat_errors)

        return errors

    def _validate_validate_action(
        self, action: dict[str, Any], schema: dict[str, Any], index: int
    ) -> list[ValidationError]:
        """
        @methoddesc 验证校验操作

        检查 VALIDATE_PROJECT 动作中指定的表是否存在。

        参数:
            action: 动作字典
            schema: 项目结构
            index: 动作索引

        返回:
            错误列表
        """
        errors = []
        action_type = action.get("actionType", "")
        spec = action.get("constraintSpec", {})

        # 获取要校验的表
        table_id = spec.get("targetNodeId")
        table_name = spec.get("tableName")
        tables = spec.get("tables") or spec.get("tableIds", [])

        # 如果没有指定表，校验所有表，这是合法的
        if not table_id and not table_name and not tables:
            return errors

        # 验证指定的表是否存在
        tables_to_check = []
        if tables:
            tables_to_check = tables
        elif table_id:
            tables_to_check = [table_id]
        elif table_name:
            tables_to_check = [table_name]

        for table_ref in tables_to_check:
            table_exists = False
            if table_ref in schema["tables"]:
                table_exists = True
            elif table_ref in schema["table_name_to_id"]:
                table_exists = True

            if not table_exists:
                suggestion = suggest_similar_table(table_ref, schema)
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="table_not_found",
                        message=f"要校验的表 '{table_ref}' 不存在",
                        suggestion=suggestion,
                    )
                )

        return errors

    def _validate_constraint_params(
        self, constraint_type: str, spec: dict[str, Any], index: int, action_type: str
    ) -> list[ValidationError]:
        """
        @methoddesc 验证约束参数完整性

        检查约束动作中是否包含该约束类型所需的必填参数。

        参数:
            constraint_type: 标准化后的约束类型
            spec: constraintSpec
            index: 动作索引
            action_type: 动作类型

        返回:
            错误列表
        """
        errors = []
        params = spec.get("params", {})

        # 检查必需参数
        required = self.CONSTRAINT_REQUIRED_PARAMS.get(constraint_type, [])
        if required:
            # 特殊处理 Range：min 和 max 至少需要一个
            if constraint_type == "Range":
                has_min = "min" in params and params["min"] is not None
                has_max = "max" in params and params["max"] is not None
                if not has_min and not has_max:
                    errors.append(
                        ValidationError(
                            action_index=index,
                            action_type=action_type,
                            error_type="missing_required_param",
                            message=f"{constraint_type} 约束需要至少一个 'min' 或 'max' 参数",
                            suggestion="请添加 params.min 或 params.max",
                        )
                    )
            else:
                # 其他约束类型：所有必需参数都必须存在
                missing = [p for p in required if p not in params or params[p] is None]
                if missing:
                    errors.append(
                        ValidationError(
                            action_index=index,
                            action_type=action_type,
                            error_type="missing_required_param",
                            message=f"{constraint_type} 约束缺少必需参数: {', '.join(missing)}",
                            suggestion=f"请在 params 中添加: {', '.join(missing)}",
                        )
                    )

        # 特殊处理：验证外键引用表存在
        if constraint_type == "ForeignKey":
            fk_errors = self._validate_foreign_key_reference(spec, index, action_type)
            errors.extend(fk_errors)

        return errors

    def _validate_foreign_key_reference(
        self, spec: dict[str, Any], index: int, action_type: str
    ) -> list[ValidationError]:
        """
        @methoddesc 验证外键引用表和字段存在

        检查外键约束引用的目标表和目标字段是否存在于项目中。

        参数:
            spec: constraintSpec
            index: 动作索引
            action_type: 动作类型

        返回:
            错误列表
        """
        errors = []
        params = spec.get("params", {})
        schema = self._load_project_schema()

        to_table_id = params.get("toTableId")
        to_column_id = params.get("toColumnId")

        if to_table_id:
            if to_table_id not in schema["tables"]:
                # 表不存在
                suggestion = suggest_similar_table(to_table_id, schema)
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="foreign_key_table_not_found",
                        message=f"外键引用的表 '{to_table_id}' 不存在",
                        suggestion=suggestion,
                    )
                )
            else:
                # 表存在，验证字段
                ref_table = schema["tables"][to_table_id]
                if to_column_id:
                    column_exists = False
                    for col_id, col_data in ref_table["columns"].items():
                        if col_id == to_column_id or col_data["name"] == to_column_id:
                            column_exists = True
                            break

                    if not column_exists:
                        available_cols = list(ref_table["columns"].keys())[:5]
                        errors.append(
                            ValidationError(
                                action_index=index,
                                action_type=action_type,
                                error_type="foreign_key_column_not_found",
                                message=f"外键引用的字段 '{to_column_id}' 在表 '{ref_table['name']}' 中不存在",
                                suggestion=f"可用字段: {', '.join(available_cols)}...",
                            )
                        )

        return errors

    def _validate_type_compatibility(
        self, column_info: dict[str, Any], constraint_type: str, index: int, action_type: str
    ) -> list[ValidationError]:
        """
        @methoddesc 验证字段类型与约束类型兼容性

        检查约束类型是否适用于目标字段的数据类型，
        例如 Range 约束只能用于数值类型字段。

        参数:
            column_info: 字段信息
            constraint_type: 约束类型
            index: 动作索引
            action_type: 动作类型

        返回:
            错误列表
        """
        errors = []
        col_type = column_info.get("type", "string").lower()

        # 数值类型约束只能用于数值字段
        numeric_constraints = {"Range", "DATE_LOGIC"}
        numeric_types = {"integer", "int", "decimal", "float", "number", "numeric"}

        if constraint_type in numeric_constraints and col_type not in numeric_types:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="type_incompatibility",
                    message=f"不能对 {col_type} 类型的字段使用 {constraint_type} 约束",
                    suggestion=f"建议对 {col_type} 类型使用: " + suggest_constraints_for_type(col_type),
                )
            )

        return errors

    def _validate_schema_action(self, action: dict[str, Any], index: int) -> list[ValidationError]:
        """
        @methoddesc 验证 Schema 操作

        检查 schemaSpec 中的名称、列定义合法性。

        参数:
            action: 动作字典
            index: 动作索引

        返回:
            错误列表
        """
        errors = []
        action_type = action.get("actionType", "")
        spec = action.get("schemaSpec", {})

        name = spec.get("name", "")
        schema_id = spec.get("schemaId") or spec.get("id")

        if action_type in ("ADD_SCHEMA", "UPDATE_SCHEMA") and not name and not schema_id:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="missing_schema_name",
                    message="Schema 名称不能为空",
                    suggestion="请指定 name 字段",
                )
            )

        # 验证列定义
        columns = spec.get("columns", [])
        if columns is not None:
            for col in columns:
                col_type = col.get("type", "string")
                if col_type not in self.VALID_DATA_TYPES:
                    errors.append(
                        ValidationError(
                            action_index=index,
                            action_type=action_type,
                            error_type="invalid_column_type",
                            message=f"不支持的数据类型: '{col_type}'",
                            suggestion=f"可用类型: {', '.join(sorted(self.VALID_DATA_TYPES))}",
                        )
                    )

        if action_type in ("UPDATE_SCHEMA", "DELETE_SCHEMA") and not schema_id and not name:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="missing_schema_id",
                    message="更新/删除 Schema 需要指定 schemaId 或 name",
                )
            )

        return errors

    def _validate_regex_action(self, action: dict[str, Any], index: int) -> list[ValidationError]:
        """
        @methoddesc 验证 Regex 操作

        检查 regexSpec 中的名称、模式、匹配模式合法性。

        参数:
            action: 动作字典
            index: 动作索引

        返回:
            错误列表
        """
        errors = []
        action_type = action.get("actionType", "")
        spec = action.get("regexSpec", {})

        if action_type == "ADD_REGEX":
            name = spec.get("name", "")
            pattern = spec.get("pattern", "")
            if not name:
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="missing_regex_name",
                        message="Regex 名称不能为空",
                    )
                )
            if not pattern:
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="missing_regex_pattern",
                        message="Regex 模式不能为空",
                    )
                )

        match_mode = spec.get("matchMode")
        if match_mode and match_mode not in {"full", "partial", "extract"}:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="invalid_match_mode",
                    message=f"不支持的匹配模式: '{match_mode}'",
                    suggestion="可选: full, partial, extract",
                )
            )

        if action_type in ("UPDATE_REGEX", "DELETE_REGEX"):
            regex_id = spec.get("regexId") or spec.get("id") or spec.get("name")
            if not regex_id:
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="missing_regex_id",
                        message="更新/删除 Regex 需要指定 regexId 或 name",
                    )
                )

        return errors

    def _validate_transform_action(self, action: dict[str, Any], index: int) -> list[ValidationError]:
        """
        @methoddesc 验证 Transform 操作

        检查 transformSpec 中的类型、参数合法性。

        参数:
            action: 动作字典
            index: 动作索引

        返回:
            错误列表
        """
        errors = []
        action_type = action.get("actionType", "")
        spec = action.get("transformSpec", {})

        if action_type == "ADD_TRANSFORM":
            transform_type = spec.get("type", "")
            if not transform_type:
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="missing_transform_type",
                        message="Transform 类型不能为空",
                        suggestion=f"可选: {', '.join(sorted(self.VALID_TRANSFORM_TYPE_NAMES))}",
                    )
                )
            elif transform_type not in self.VALID_TRANSFORM_TYPE_NAMES:
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="invalid_transform_type",
                        message=f"不支持的 Transform 类型: '{transform_type}'",
                        suggestion=f"可选: {', '.join(sorted(self.VALID_TRANSFORM_TYPE_NAMES))}",
                    )
                )

        if action_type in ("UPDATE_TRANSFORM", "DELETE_TRANSFORM"):
            transform_id = spec.get("transformId") or spec.get("id")
            if not transform_id:
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="missing_transform_id",
                        message="更新/删除 Transform 需要指定 transformId",
                    )
                )

        return errors

    def _validate_settings_action(self, action: dict[str, Any], index: int) -> list[ValidationError]:
        """
        @methoddesc 验证 Settings 操作

        检查 settingsSpec 中的 category 和 settings 合法性。

        参数:
            action: 动作字典
            index: 动作索引

        返回:
            错误列表
        """
        errors = []
        action_type = action.get("actionType", "")
        spec = action.get("settingsSpec", {})

        category = spec.get("category", "")
        settings = spec.get("settings", {})

        if not category:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="missing_settings_category",
                    message="缺少 settings category",
                    suggestion=f"可选: {', '.join(sorted(self.VALID_SETTINGS_CATEGORIES))}",
                )
            )
        elif category not in self.VALID_SETTINGS_CATEGORIES:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="invalid_settings_category",
                    message=f"未知的 settings category: '{category}'",
                    suggestion=f"可选: {', '.join(sorted(self.VALID_SETTINGS_CATEGORIES))}",
                )
            )

        if not settings:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="empty_settings",
                    message="settings 不能为空",
                )
            )

        return errors


def format_validation_result(result: ValidationResult) -> str:
    """
    @methoddesc 格式化验证结果为可读文本

    将 ValidationResult 中的错误、警告和有效动作信息格式化为人类可读的文本。

    参数:
        result: 验证结果

    返回:
        格式化后的文本
    """
    lines = []

    if result.all_valid and not result.warnings:
        return "[OK] 所有操作验证通过"

    if result.errors:
        lines.append(f"[!] 发现 {len(result.errors)} 个问题:")
        for error in result.errors:
            lines.append(f"\n  [{error.action_index + 1}] {error.action_type}")
            lines.append(f"      错误: {error.message}")
            if error.suggestion:
                lines.append(f"      建议: {error.suggestion}")

    if result.warnings:
        lines.append(f"\n[!] {len(result.warnings)} 个警告:")
        for warning in result.warnings:
            lines.append(f"  - {warning.message}")

    if result.partial_valid:
        lines.append(f"\n[i] {len(result.valid_actions)} 个操作有效，{len(result.invalid_action_indices)} 个操作无效")

    return "\n".join(lines)
