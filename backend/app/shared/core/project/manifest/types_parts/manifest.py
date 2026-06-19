"""
@fileoverview Manifest 主类型定义模块

功能概述:
- 定义项目清单 (ProjectManifest) 的核心数据结构
- 整合项目信息、设置、Schema/Constraint/Regex 引用、数据源配置

架构设计:
- 主入口模型: ProjectManifest 是 manifest.yaml 解析后的根对象
- ID 唯一性校验: 自动检测并处理重复的 ID
- 默认值处理: schemas/constraints/regex_nodes/data_sources 默认为空列表

输入示例 (manifest.yaml):
    version: 2

    project:
      name: 我的数据项目
      description: 这是一个测试项目

    settings:
      file_processing:
        default_encoding: utf-8
        csv_delimiter: ","
      validation:
        parallel_workers: 4

    schemas:
      - id: users
        path: schemas/users.yaml
      - id: orders
        path: schemas/orders.yaml

    constraints:
      - id: users_not_null
        path: constraints/users_not_null.yaml

    regex_nodes:
      - id: email_pattern
        path: regex/email.yaml

    data_sources:
      - id: primary
        path: data
        mode: relative
        description: 主数据目录

    patterns_dir: patterns

输出示例 (Python 对象):
    ProjectManifest(
        version=2,
        project=ProjectInfo(name="我的数据项目", description="这是一个测试项目"),
        settings=ProjectSettings(...),
        schemas=[SchemaRef(...), ...],
        constraints=[ConstraintRef(...), ...],
        regex_nodes=[RegexRef(...), ...],
        data_sources=[DataSourceRef(id="primary", path="data", mode="relative")],
        patterns_dir="patterns",
        warnings=[]
    )
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator

from app.shared.core.project.manifest.types_parts.constants import V2_VERSION
from app.shared.core.project.manifest.types_parts.data_source import DataSourceRef
from app.shared.core.project.manifest.types_parts.info import ProjectInfo
from app.shared.core.project.manifest.types_parts.refs import ConstraintRef, RegexRef, SchemaRef, TransformRef
from app.shared.core.project.manifest.types_parts.settings import ProjectSettings
from app.shared.core.project.manifest.types_parts.template import TemplateInstanceRef, TemplateRef


class ProjectManifest(BaseModel):
    """@classdesc 项目清单主类型

    这是 manifest.yaml 文件解析后的根对象，包含了项目的所有配置引用。

    字段说明:
        - version: 配置版本号，当前固定为 2
        - project: 项目基本信息 (名称、描述等)
        - settings: 项目设置 (文件处理、验证规则等)
        - schemas: Schema 文件引用列表
        - constraints: Constraint 文件引用列表
        - regex_nodes: Regex 节点文件引用列表
        - data_sources: 数据源目录引用列表（用于全量校验）
        - patterns_dir: patterns 目录路径
        - warnings: 加载过程中产生的警告信息

    数据校验:
        - ID 唯一性: 自动检测重复的 schema/constraint/regex/data_source ID，保留第一个
        - None 转换: schemas/constraints/regex_nodes/data_sources 如果为 None，自动转为空列表

    示例:
        # YAML 文件内容
        version: 2
        project:
          name: 用户管理系统
        schemas:
          - id: users
            path: schemas/users.yaml
          - id: users  # 重复 ID
            path: schemas/users_dup.yaml
        data_sources:
          - id: primary
            path: data
            mode: relative

        # 解析后的对象 (重复的会被自动处理)
        ProjectManifest(
            version=2,
            project=ProjectInfo(name="用户管理系统", ...),
            schemas=[SchemaRef(id="users", path="schemas/users.yaml")],
            data_sources=[DataSourceRef(id="primary", path="data", mode="relative")],
            warnings=["Schema ID 'users' 重复，已跳过 'schemas/users_dup.yaml'"]
        )
    """

    version: int = Field(V2_VERSION, description="配置版本号（固定为 2）")
    project: ProjectInfo
    settings: ProjectSettings = Field(default_factory=ProjectSettings, description="项目设置")
    schemas: list[SchemaRef] = Field(default_factory=list, description="Schema 文件索引")
    constraints: list[ConstraintRef] = Field(default_factory=list, description="Constraint 文件索引")
    regex_nodes: list[RegexRef] = Field(default_factory=list, description="Regex 节点文件索引")
    transforms: list[TransformRef] = Field(default_factory=list, description="Transform 功能节点文件索引")
    data_sources: list[DataSourceRef] = Field(default_factory=list, description="数据源目录索引")
    templates: list[TemplateRef] = Field(default_factory=list, description="模板定义文件索引")
    template_instances: list[TemplateInstanceRef] = Field(default_factory=list, description="模板实例索引")
    patterns_dir: str = Field("patterns", description="patterns 目录（相对路径）")
    warnings: list[str] = Field(default_factory=list, description="加载时的警告信息")

    @field_validator(
        "schemas",
        "constraints",
        "regex_nodes",
        "transforms",
        "data_sources",
        "templates",
        "template_instances",
        mode="before",
    )
    @classmethod
    def _coerce_none_to_list(cls, v):
        if v is None:
            return []
        return v

    @model_validator(mode="after")
    def _validate_unique_ids(self) -> ProjectManifest:
        warnings: list[str] = []

        seen_schema_ids: dict[str, SchemaRef] = {}
        unique_schemas: list[SchemaRef] = []
        for schema in self.schemas:
            if schema.id in seen_schema_ids:
                existing: SchemaRef = seen_schema_ids[schema.id]
                warnings.append(f"Schema ID '{schema.id}' 重复，已跳过 '{schema.path}'，保留 '{existing.path}'")
            else:
                seen_schema_ids[schema.id] = schema
                unique_schemas.append(schema)
        self.schemas = unique_schemas

        seen_constraint_ids: dict[str, ConstraintRef] = {}
        unique_constraints: list[ConstraintRef] = []
        for constraint in self.constraints:
            if constraint.id in seen_constraint_ids:
                existing: ConstraintRef = seen_constraint_ids[constraint.id]
                warnings.append(
                    f"Constraint ID '{constraint.id}' 重复，已跳过 '{constraint.path}'，保留 '{existing.path}'"
                )
            else:
                seen_constraint_ids[constraint.id] = constraint
                unique_constraints.append(constraint)
        self.constraints = unique_constraints

        seen_regex_ids: dict[str, RegexRef] = {}
        unique_regex_nodes: list[RegexRef] = []
        for regex in self.regex_nodes:
            if regex.id in seen_regex_ids:
                existing: RegexRef = seen_regex_ids[regex.id]
                warnings.append(f"Regex ID '{regex.id}' 重复，已跳过 '{regex.path}'，保留 '{existing.path}'")
            else:
                seen_regex_ids[regex.id] = regex
                unique_regex_nodes.append(regex)
        self.regex_nodes = unique_regex_nodes

        seen_transform_ids: dict[str, TransformRef] = {}
        unique_transforms: list[TransformRef] = []
        for transform in self.transforms:
            if transform.id in seen_transform_ids:
                existing: TransformRef = seen_transform_ids[transform.id]
                warnings.append(
                    f"Transform ID '{transform.id}' 重复，已跳过 '{transform.path}'，保留 '{existing.path}'"
                )
            else:
                seen_transform_ids[transform.id] = transform
                unique_transforms.append(transform)
        self.transforms = unique_transforms

        seen_data_source_ids: dict[str, DataSourceRef] = {}
        unique_data_sources: list[DataSourceRef] = []
        for ds in self.data_sources:
            if ds.id in seen_data_source_ids:
                existing: DataSourceRef = seen_data_source_ids[ds.id]
                warnings.append(f"DataSource ID '{ds.id}' 重复，已跳过 '{ds.path}'，保留 '{existing.path}'")
            else:
                seen_data_source_ids[ds.id] = ds
                unique_data_sources.append(ds)
        self.data_sources = unique_data_sources

        # 模板定义 ID 去重
        seen_template_ids: dict[str, TemplateRef] = {}
        unique_templates: list[TemplateRef] = []
        for tmpl in self.templates:
            if tmpl.id in seen_template_ids:
                existing: TemplateRef = seen_template_ids[tmpl.id]
                warnings.append(f"Template ID '{tmpl.id}' 重复，已跳过 '{tmpl.path}'，保留 '{existing.path}'")
            else:
                seen_template_ids[tmpl.id] = tmpl
                unique_templates.append(tmpl)
        self.templates = unique_templates

        # 模板实例 ID 去重
        seen_instance_ids: dict[str, TemplateInstanceRef] = {}
        unique_instances: list[TemplateInstanceRef] = []
        for inst in self.template_instances:
            if inst.id in seen_instance_ids:
                existing: TemplateInstanceRef = seen_instance_ids[inst.id]
                warnings.append(
                    f"TemplateInstance ID '{inst.id}' 重复，"
                    f"已跳过 (template_id={inst.template_id})，"
                    f"保留 (template_id={existing.template_id})"
                )
            else:
                seen_instance_ids[inst.id] = inst
                unique_instances.append(inst)
        self.template_instances = unique_instances

        self.warnings = warnings
        return self
