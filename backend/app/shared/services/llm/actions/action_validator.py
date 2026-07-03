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

实现说明:
- 数据类 (ValidationError/ValidationResult) 与格式化函数已提取到 validation_types.py
- 各动作类型验证逻辑已拆分到 _constraint_validator / _schema_validator /
  _regex_validator / _transform_validator / _settings_validator
- 本模块保留 ActionValidator 主类，作为门面委托给上述子模块
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.shared.services.llm.actions._canvas_validator import validate_canvas_action
from app.shared.services.llm.actions._constraint_validator import (
    validate_constraint_action,
    validate_foreign_key_reference,
    validate_type_compatibility,
    validate_validate_action,
)
from app.shared.services.llm.actions._regex_validator import validate_regex_action
from app.shared.services.llm.actions._schema_validator import validate_schema_action
from app.shared.services.llm.actions._settings_validator import validate_settings_action
from app.shared.services.llm.actions._transform_validator import validate_transform_action
from app.shared.services.llm.actions.registry import (
    ALL_CONSTRAINT_TYPES,
    REGEX_ACTION_TYPES,
    SCHEMA_ACTION_TYPES,
    SETTINGS_CATEGORIES,
    TRANSFORM_ACTION_TYPES,
)
from app.shared.services.llm.actions.registry import CONSTRAINT_REQUIRED_PARAMS as CONSTRAINT_REQUIRED_PARAMS_REGISTRY
from app.shared.services.llm.actions.specs import SpecParseError, parse_action_spec
from app.shared.services.llm.actions.validation_types import (
    ValidationError,
    ValidationResult,
    format_validation_result,
)

# 重新导出以保持向后兼容
__all__ = [
    "ActionValidator",
    "ValidationError",
    "ValidationResult",
    "format_validation_result",
]

logger = logging.getLogger(__name__)


class ActionValidator:
    """
    @classdesc 动作预验证器

    验证 AI 生成的动作在执行前的业务逻辑可行性。
    加载项目 schema，检查表/字段存在性、约束类型有效性、参数完整性等。

    Attributes:
        project_path: 项目路径
        _project_schema: 缓存的项目结构信息
    """

    # 以下白名单均从动作注册表（单一事实源）派生，禁止本地硬编码。
    # 保留类属性形式以兼容现有引用（如 _constraint_validator 经回调注入使用）。
    VALID_CONSTRAINT_TYPES = set(ALL_CONSTRAINT_TYPES)
    VALID_SCHEMA_TYPES = set(SCHEMA_ACTION_TYPES)
    VALID_REGEX_TYPES = set(REGEX_ACTION_TYPES)
    VALID_TRANSFORM_TYPES = set(TRANSFORM_ACTION_TYPES)
    VALID_SETTINGS_CATEGORIES = set(SETTINGS_CATEGORIES)

    # 需要特定参数的约束类型（从注册表派生）
    CONSTRAINT_REQUIRED_PARAMS = dict(CONSTRAINT_REQUIRED_PARAMS_REGISTRY)

    def __init__(self, project_path: str):
        self.project_path = Path(project_path)
        self._project_schema: dict[str, Any] | None = None

    def _load_project_schema(self) -> dict[str, Any]:
        """加载项目结构信息

        读取 schemas 目录下的 YAML 文件，构建表和字段索引。
        结果会被缓存。
        """
        if self._project_schema is not None:
            return self._project_schema

        schema: dict[str, Any] = {
            "tables": {},
            "table_name_to_id": {},
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

    def _fk_check(self, spec: dict[str, Any], index: int, action_type: str) -> list[ValidationError]:
        """外键引用检查（注入到约束验证的回调中）"""
        return validate_foreign_key_reference(spec, index, action_type, self._load_project_schema())

    def _type_compat_check(
        self, column_info: dict[str, Any], constraint_type: str, index: int, action_type: str
    ) -> list[ValidationError]:
        """类型兼容性检查（注入到约束验证的回调中）"""
        return validate_type_compatibility(column_info, constraint_type, index, action_type)

    def validate(self, actions: list[dict[str, Any]]) -> ValidationResult:
        """验证动作列表

        遍历所有动作，根据动作类型调用对应的验证方法。
        """
        result = ValidationResult()
        schema = self._load_project_schema()

        for index, action in enumerate(actions):
            action_type = action.get("actionType", "")

            # 结构校验前置（Pydantic）：枚举、必填、Range min<=max 等不依赖项目状态的规则。
            # 失败则跳过该动作的上下文校验（数据已非法，上下文校验无意义），直接标记无效。
            # 这是 specs.py 与各 validator 的分工：specs 管结构，validator 管上下文（表/列/FK 存在性）。
            try:
                parse_action_spec(action)
            except SpecParseError as e:
                result.errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="spec_structure_invalid",
                        message=e.message,
                        suggestion="请检查 spec 字段结构（类型枚举、必填字段、参数关系）",
                    )
                )
                result.invalid_action_indices.add(index)
                continue

            if action_type in [
                "ADD_CONSTRAINT_NODE",
                "UPDATE_CONSTRAINT_NODE",
                "DELETE_CONSTRAINT_NODE",
            ]:
                errors = validate_constraint_action(
                    action,
                    schema,
                    index,
                    self.CONSTRAINT_REQUIRED_PARAMS,
                    self._type_compat_check,
                    self._fk_check,
                )
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            elif action_type == "VALIDATE_PROJECT":
                errors = validate_validate_action(action, schema, index)
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            elif action_type in self.VALID_SCHEMA_TYPES:
                errors = validate_schema_action(action, index)
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            elif action_type in self.VALID_REGEX_TYPES:
                errors = validate_regex_action(action, index)
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            elif action_type in self.VALID_TRANSFORM_TYPES:
                errors = validate_transform_action(action, index)
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            elif action_type == "UPDATE_SETTINGS":
                errors = validate_settings_action(action, index)
                result.errors.extend(errors)
                if errors:
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            elif action_type == "ADD_TO_CANVAS":
                # ADD_TO_CANVAS 不写盘，但仍需校验目标资源真实存在（避免显示不存在的资源）
                errors = validate_canvas_action(action, index, str(self.project_path))
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
