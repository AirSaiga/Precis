"""
@fileoverview 表结构类型定义模块

功能概述:
- 定义 Schema 文件的主要结构 (TableSchemaFile)
- 包含表 ID、名称、列定义、约束、数据源等

架构设计:
- 主模型: TableSchemaFile 是 schema.yaml 解析后的根对象
- 验证: 自动检查列 ID/name 唯一性、约束 ID 唯一性
- 兼容性: source.sheet 和 sheet 字段互斥

输入示例 (schema.yaml):
    version: 2
    id: sc_xxxencodedid
    name: 用户表
    source:
      path: data/users.xlsx
      sheet: Sheet1
      header_row: 0
    columns:
      - id: col_1
        name: id
        type: integer
        primary_key: true
      - id: col_2
        name: username
        type: string
        nullable: false
    constraints:
      - id: not_null_username
        type: NotNull
        column: username

输出示例:
    TableSchemaFile(
        version=2,
        id="sc_xxxencodedid",
        name="用户表",
        source=SourceSpec(path="data/users.xlsx", sheet="Sheet1", header_row=0),
        columns=[
            ColumnSpec(id="col_1", name="id", type="integer", primary_key=True),
            ColumnSpec(id="col_2", name="username", type="string", nullable=False)
        ],
        constraints=[
            ConstraintItem(id="not_null_username", type="NotNull", column="username")
        ],
        script_checks=[]
    )
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.shared.core.project.schema.types_parts.column import ColumnSpec
from app.shared.core.project.schema.types_parts.constraint import ConstraintItem
from app.shared.core.project.schema.types_parts.source import SourceSpec


class TableSchemaFile(BaseModel):
    """@classdesc 表结构文件模型

    这是一个 schema.yaml 文件解析后的根对象。

    字段说明:
        - version: 配置文件版本，固定为 2
        - id: 表的唯一标识符 (系统生成或手动指定)
        - name: 表的展示名称 (用于 UI 显示和校验错误提示)
        - source: 数据源描述 (可选，不提供时自动发现)
        - sheet: Excel 工作表名 (与 source.sheet 互斥)
        - columns: 列定义列表
        - constraints: 内嵌约束列表 (可直接在 schema 中定义)
        - script_checks: 脚本化检查列表

    数据校验:
        - 列 ID 唯一性: 所有 columns.id 必须唯一
        - 列名唯一性: 所有 columns.name 必须唯一
        - 约束 ID 唯一性: 所有 constraints.id 必须唯一
        - sheet 一致性: source.sheet 和 sheet 字段不能同时指定且不同

    示例:
        # 最小配置
        id: users
        name: 用户表
        columns:
          - id: col_1
            name: id
            type: integer
    """

    version: int = Field(2, description="配置版本号（固定为 2）")
    id: str = Field(..., description="表 ID（稳定标识）")
    name: str = Field(..., description="表名（展示/校验/数据文件发现使用）")
    source: SourceSpec | None = Field(None, description="数据源描述（为空时根据 name 自动发现）")
    sheet: str | None = Field(None, description="Excel 工作表名称")
    columns: list[ColumnSpec] = Field(default_factory=list, description="列定义列表")
    constraints: list[ConstraintItem] = Field(
        default_factory=list,
        description="内嵌约束列表（可直接在 schema.yaml 中定义，无需独立文件）",
    )
    script_checks: list[dict[str, Any]] = Field(default_factory=list, description="脚本化检查")

    @model_validator(mode="after")
    def _validate_source_sheet_compatibility(self) -> TableSchemaFile:
        """@methoddesc 验证 source.sheet 和 sheet 字段的一致性

        业务规则：
        - source.sheet 和 sheet 字段表示同一个含义（Excel 工作表名）
        - 如果两者同时指定且值不同，会导致歧义，不知道以哪个为准
        - 校验逻辑：如果同时存在且不一致，抛出 ValueError

        为什么需要这个校验？
        - 防止用户在两个地方写了不同的工作表名，导致数据读取错误
        - 建议：优先使用 source.sheet，sheet 字段为兼容保留

        示例:
            # 合法：只在一个地方声明
            source:
              sheet: Sheet1

            # 合法：两处声明一致
            source:
              sheet: Sheet1
            sheet: Sheet1

            # 非法：两处声明不一致（会抛出 ValueError）
            source:
              sheet: Sheet1
            sheet: Sheet2
        """
        if self.source and self.sheet:
            source_sheet = self.source.sheet
            if source_sheet and source_sheet != self.sheet:
                raise ValueError(
                    f"source.sheet ('{source_sheet}') 与 sheet ('{self.sheet}') 不一致。请只在一个位置声明 sheet 名称。"
                )
        return self

    @model_validator(mode="after")
    def _validate_columns_unique(self) -> TableSchemaFile:
        """@methoddesc 验证列 ID 和列名的唯一性

        业务规则：
        - 同一表内的所有列 ID 必须唯一（用于内部引用）
        - 同一表内的所有列名必须唯一（用于数据访问和展示）

        校验逻辑：
        1. 提取所有列的 id 列表
        2. 使用 set 去重后比较长度，如果不相等说明有重复
        3. 同样方式检查 name 列表

        为什么需要这个校验？
        - 列 ID 用于约束和正则节点中引用列，重复会导致引用歧义
        - 列名用于数据加载时的列识别，重复会导致数据覆盖

        示例:
            # 合法：列 ID 和列名都唯一
            columns:
              - id: col_1, name: id
              - id: col_2, name: name

            # 非法：列 ID 重复（会抛出 ValueError）
            columns:
              - id: col_1, name: id
              - id: col_1, name: name

            # 非法：列名重复（会抛出 ValueError）
            columns:
              - id: col_1, name: email
              - id: col_2, name: email
        """
        ids = [c.id for c in self.columns]
        if len(set(ids)) != len(ids):
            raise ValueError("columns.id 必须唯一")

        names = [c.name for c in self.columns]
        if len(set(names)) != len(names):
            raise ValueError("columns.name 必须唯一")

        return self

    @model_validator(mode="after")
    def _validate_constraints_unique(self) -> TableSchemaFile:
        """@methoddesc 验证约束 ID 的唯一性

        业务规则：
        - 同一表内的所有约束 ID 必须唯一

        校验逻辑：
        1. 提取所有约束的 id 列表
        2. 使用 set 去重后比较长度，如果不相等说明有重复

        为什么需要这个校验？
        - 约束 ID 用于错误报告中标识具体的约束规则
        - 重复的约束 ID 会导致无法区分是哪个约束触发了错误

        示例:
            # 合法：约束 ID 唯一
            constraints:
              - id: not_null_email, type: NotNull, column: email
              - id: unique_name, type: Unique, columns: [name]

            # 非法：约束 ID 重复（会抛出 ValueError）
            constraints:
              - id: check_email, type: NotNull, column: email
              - id: check_email, type: Unique, column: email
        """
        constraint_ids = [c.id for c in self.constraints]
        if len(set(constraint_ids)) != len(constraint_ids):
            raise ValueError("constraints.id 必须唯一")

        return self
