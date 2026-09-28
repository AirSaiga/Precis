# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
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
    CANVAS_ACTION_TYPES,
    PROJECT_ACTION_TYPES,
    REGEX_ACTION_TYPES,
    SCHEMA_ACTION_TYPES,
    SETTINGS_CATEGORIES,
    TRANSFORM_ACTION_TYPES,
    is_read_only,
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

    def __init__(self, project_path: str, canvas_enabled: bool = True):
        """
        @methoddesc 初始化验证器

        参数:
            project_path: 项目路径
            canvas_enabled: 当前环境是否有画布。无画布客户端（CLI 等经
                ChatOptions.canvas_enabled=False 透传）传 False——canvas 类动作
                （ADD_TO_CANVAS）直接判 error 拒绝，错误信息回灌给 LLM 自我修正
        """
        self.project_path = Path(project_path)
        self.canvas_enabled = canvas_enabled
        self._project_schema: dict[str, Any] | None = None

    def _load_project_schema(self) -> dict[str, Any]:
        """加载项目结构信息（manifest 为权威事实源）

        事实源收敛（与运行时装载器 load_project 对齐）：
        - manifest 存在时：只有登记进 project.precis.yaml 的 schema 才进
          tables / table_name_to_id（权威表集合）；磁盘 glob 到但未登记的进
          unlisted_tables 映射（id/name → 路径）——预验证引用这类表时给出
          table_unlisted 针对性错误（引导先 UPDATE_SCHEMA 登记），而不是
          放行后让运行时 ReferenceIntegrityError 爆炸。
        - manifest 不存在时：退回磁盘全量口径（项目未初始化场景由
          manifest_missing 门拦截写动作，VALIDATE_PROJECT 等只读动作按
          磁盘可见表放行，保持既有行为）。

        结果会被缓存。结构：
            {
                "tables": {id: {"name", "columns": {col_id: {"name","type"}}}},
                "table_name_to_id": {name: [id, ...]},
                "unlisted_tables": {id或name: {"id", "name", "path"}},
            }
        """
        if self._project_schema is not None:
            return self._project_schema

        schema: dict[str, Any] = {
            "tables": {},
            "table_name_to_id": {},
            "unlisted_tables": {},
        }

        schemas_dir = self.project_path / "schemas"
        if not schemas_dir.exists():
            logger.warning(f"Schemas 目录不存在: {schemas_dir}")
            self._project_schema = schema
            return schema

        # manifest 登记的 schema 引用路径集合（归一化比对，与 coverage.py 口径一致）
        listed_paths: set[str] | None = None
        manifest_path = self.project_path / "project.precis.yaml"
        if manifest_path.is_file():
            listed_paths = set()
            try:
                import yaml

                with open(manifest_path, encoding="utf-8") as f:
                    manifest_data = yaml.safe_load(f) or {}
                for ref in manifest_data.get("schemas", []) or []:
                    p = ref.get("path") if isinstance(ref, dict) else None
                    if isinstance(p, str) and p:
                        listed_paths.add(p.replace("\\", "/").lower())
            except Exception as e:
                # manifest 不可读：按"无清单"退化处理（磁盘全量口径），避免误杀
                logger.warning(f"读取 manifest schemas 失败，预验证退回磁盘口径: {e}")
                listed_paths = None

        try:
            import yaml

            for schema_file in schemas_dir.glob("*.yaml"):
                try:
                    with open(schema_file, encoding="utf-8") as f:
                        data = yaml.safe_load(f) or {}

                    table_id = data.get("id", "")
                    table_name = data.get("name", "")
                    columns = data.get("columns", [])

                    if not table_id:
                        continue

                    # manifest 存在时按登记路径判定权威性（None = 无清单，全量权威）
                    rel_path = f"schemas/{schema_file.name}".replace("\\", "/").lower()
                    listed = listed_paths is None or rel_path in listed_paths

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

                    if listed:
                        schema["tables"][table_id] = {
                            "name": table_name,
                            "columns": column_info,
                        }

                        if table_name:
                            if table_name not in schema["table_name_to_id"]:
                                schema["table_name_to_id"][table_name] = []
                            schema["table_name_to_id"][table_name].append(table_id)
                    else:
                        # 未登记（孤儿文件）：进 unlisted 映射，id 与 name 双键索引
                        entry = {
                            "id": table_id,
                            "name": table_name,
                            "path": f"schemas/{schema_file.name}",
                        }
                        schema["unlisted_tables"][table_id] = entry
                        if table_name and table_name != table_id:
                            schema["unlisted_tables"].setdefault(table_name, entry)

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

        # 项目清单存在性（一次性判定）：INIT_PROJECT 仅在缺失时合法；其余写动作
        # 在缺失时整批拦截并引导先初始化——否则资源文件写盘后无处登记，产出孤儿
        manifest_missing = not (self.project_path / "project.precis.yaml").is_file()

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

            if action_type in PROJECT_ACTION_TYPES:
                if not manifest_missing:
                    result.errors.append(
                        ValidationError(
                            action_index=index,
                            action_type=action_type,
                            error_type="manifest_already_exists",
                            message="项目清单 project.precis.yaml 已存在，无需初始化",
                            suggestion="请改用 UPDATE_SETTINGS 修改设置，或 read_project 查看现有配置",
                        )
                    )
                    result.invalid_action_indices.add(index)
                else:
                    result.valid_actions.append(action)

            # 项目未初始化：除 INIT_PROJECT 外的写动作一律拦截（写盘必然产出孤儿文件）。
            # 只读动作（VALIDATE_PROJECT/ADD_TO_CANVAS）放行——执行侧会给出带指引的失败信息
            elif manifest_missing and not is_read_only(action_type):
                result.errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="manifest_missing",
                        message="项目清单 project.precis.yaml 不存在（项目未初始化），无法执行写动作",
                        suggestion="请先单独提交 INIT_PROJECT 动作（projectSpec 可省略）创建项目清单，"
                        "成功后再提交本动作；INIT_PROJECT 与其他写动作不要混在同一批次",
                    )
                )
                result.invalid_action_indices.add(index)

            elif action_type in [
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

            elif action_type in CANVAS_ACTION_TYPES:
                # 无画布环境纵深防御：即便 LLM 绕过工具 enum 约束幻觉输出 canvas 类动作，
                # 也在此拦截并把可读原因回灌（apply_actions tool / legacy orchestrator 两路共用本验证器）
                if not self.canvas_enabled:
                    result.errors.append(
                        ValidationError(
                            action_index=index,
                            action_type=action_type,
                            error_type="canvas_unavailable",
                            message="当前环境无画布，该动作不可用",
                            suggestion="本会话没有画布界面，无法把资源显示到画布；"
                            "请改用 read_project 等查询工具回答，或 ADD/UPDATE/DELETE 等写动作",
                        )
                    )
                    result.invalid_action_indices.add(index)
                    continue
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
