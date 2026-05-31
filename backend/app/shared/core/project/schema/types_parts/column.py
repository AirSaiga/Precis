"""
@fileoverview 列类型定义模块

功能概述:
- 定义 Schema 中的列结构 (ColumnSpec)
- 支持提取列类型 (ExtractedSpec) 用于正则提取

架构设计:
- 列 ID 自动生成: 如果未指定 id，默认使用 name
- 类型灵活: type 字段可以是字符串或字典

输入示例 (schema.yaml):
    columns:
      - id: col_1
        name: id
        type: integer
        primary_key: true
      - id: col_2
        name: email
        type: string
      - id: col_3
        name: username
        type:
          name: Extracted
          source_column: email
          extract_key: username
          result_type: string

输出示例:
    ColumnSpec(
        id="col_1",
        name="id",
        type="integer",
        primary_key=True,
        expand=False
    )
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class ExtractedSpec(BaseModel):
    """@classdesc 提取列规范

    用于定义从源列中提取数据的规则。
    常用于正则提取创建派生列。

    字段说明:
        - name: 固定为 "Extracted"
        - source_column: 源列名
        - extract_key: 正则表达式中的命名捕获组
        - result_type: 提取结果的数据类型

    示例:
        # 从 email 列中提取用户名
        name: Extracted
        source_column: email
        extract_key: username
        result_type: string
    """

    name: Literal["Extracted"] = "Extracted"
    source_column: str = Field(..., description="源列名（从中提取数据）")
    extract_key: str = Field(..., description="提取键（正则命名捕获组）")
    result_type: str | None = Field(None, description="提取结果的数据类型")


class ColumnSpec(BaseModel):
    """
    @classdesc 列规范

    定义表中的一列。

    字段说明:
        - id: 列的唯一标识符 (可选，默认使用 name)
        - name: 列名 (用于显示和校验)
        - type: 数据类型
            - 简单类型: "integer", "string", "boolean" 等
            - 复杂类型: ExtractedSpec 字典
        - primary_key: 是否为主键
        - expand: 是否展开 (用于数组/对象类型)

    输入示例 (schema.yaml):
        columns:
          - id: col_1
            name: id
            type: integer
            primary_key: true
          - id: col_2
            name: email
            type: string
          - id: col_3
            name: username
            type:
              name: Extracted
              source_column: email
              extract_key: username
              result_type: string

    输出示例:
        ColumnSpec(
            id="col_1",
            name="id",
            type="integer",
            primary_key=True,
            expand=False
        )
    """

    id: str | None = Field(None, description="列 ID（稳定标识，缺失时自动使用 name）")
    name: str = Field(..., description="列名（展示/校验使用）")
    type: Any = Field(..., description="数据类型配置：支持字符串或字典（与现有 TYPE_REGISTRY 兼容）")
    primary_key: bool = Field(False, description="是否主键")
    nullable: bool = Field(True, description="是否允许为空")
    expand: bool = Field(False, description="是否展开（与现有 schema 模型保持一致）")
    json_path: str | None = Field(None, description="JSON 特有路径映射")
    children: list[ColumnSpec] | None = Field(None, description="JSON 嵌套子列（树形结构）")

    @model_validator(mode="before")
    @classmethod
    def _generate_id_from_name(cls, data: Any) -> Any:
        """@methoddesc 当未提供列 ID 时，自动使用列名作为 ID

        处理逻辑：
        1. 检查输入数据是否为字典类型（Pydantic 验证器接收原始数据）
        2. 如果是字典，检查是否同时满足以下两个条件：
           - 包含 "name" 字段（有列名可用）
           - 不包含 "id" 字段（用户未手动指定 ID）
        3. 满足条件时，将 name 的值复制给 id，实现 ID 自动补全
        4. 返回处理后的数据（无论是否修改），供后续验证流程继续处理

        为什么需要这个验证器？
        - 简化配置：用户只需写 name，不必重复写 id
        - 向后兼容：旧配置中 id 和 name 相同的场景无需修改
        - 一致性保证：确保每列都有稳定的 ID 用于内部引用

        示例:
            输入: {"name": "email", "type": "string"}
            处理: 自动补充 id -> {"name": "email", "type": "string", "id": "email"}
            输出: {"name": "email", "type": "string", "id": "email"}

            输入: {"id": "col_1", "name": "email", "type": "string"}
            处理: 已有 id，不修改 -> {"id": "col_1", "name": "email", "type": "string"}
            输出: {"id": "col_1", "name": "email", "type": "string"}
        """
        # 只有字典类型的原始数据才需要处理
        # Pydantic 验证器可能接收到 dict、已实例化的模型对象或其他类型
        if isinstance(data, dict):
            # 条件判断：有 name 但没有 id 时才自动补全
            # 使用 "in" 操作符检查键是否存在（即使值为 None 也算存在）
            if "name" in data and "id" not in data:
                # 将 name 的值赋给 id，实现自动 ID 生成
                data["id"] = data["name"]
        # 返回处理后的数据对象，供 Pydantic 继续后续验证流程
        return data
