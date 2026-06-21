"""
@fileoverview AI 生成结果数据模型

功能概述:
- 定义 AI 配置生成返回的数据结构
- 包括约束建议、正则建议及整体生成响应

架构设计:
- Pydantic 模型: 使用 BaseModel 进行数据验证和序列化
- 嵌套结构: AiGenerationResponse 聚合 AiConstraintSuggestion 和 AiRegexSuggestion

输入示例:
    suggestion = AiConstraintSuggestion(
        column_name="age", constraint_type="range", params={"min": 0, "max": 150}
    )

输出示例:
    response = AiGenerationResponse(
        constraints=[suggestion],
        regex_suggestions=[]
    )
"""

from typing import Any

from pydantic import BaseModel, Field


class AiConstraintSuggestion(BaseModel):
    """
    @classdesc AI 建议的数据约束模型

    封装 AI 为某一列建议的约束规则，包括约束类型、参数和说明。

    字段:
        table_name: 目标表名（可选）
        column_name: 目标列名（必填）
        constraint_type: 约束类型，如 "unique", "not_null", "range"
        description: 约束规则的描述说明（可选）
        params: 约束参数字典（可选）
    """

    table_name: str | None = Field(None, description="目标表名")
    column_name: str = Field(..., description="目标列名")
    constraint_type: str = Field(..., description="约束类型 (e.g., unique, not_null, range)")
    description: str | None = Field(None, description="约束规则的描述说明")
    params: dict[str, Any] | None = Field(default_factory=dict, description="约束参数 (e.g., {'min': 0, 'max': 100})")


class AiRegexSuggestion(BaseModel):
    """
    @classdesc AI 建议的正则表达式模型

    封装 AI 为某一列建议的正则校验规则。

    字段:
        table_name: 目标表名（可选）
        column_name: 目标列名（必填）
        pattern: 正则表达式模式
        regex_type: 正则类型，如 email、phone、custom（可选）
        description: 正则规则的描述说明（可选）
        params: 正则相关参数（可选）
    """

    table_name: str | None = Field(None, description="目标表名")
    column_name: str = Field(..., description="目标列名")
    pattern: str = Field(..., description="正则表达式模式")
    regex_type: str | None = Field(None, description="正则类型 (e.g., email, phone, custom)")
    description: str | None = Field(None, description="正则规则的描述说明")
    params: dict[str, Any] | None = Field(default_factory=dict, description="正则相关参数")


class AiGenerationResponse(BaseModel):
    """
    @classdesc AI 生成响应模型

    聚合 AI 配置生成的完整结果，包含所有建议的约束和正则规则。

    字段:
        table_name: 相关的表名（可选）
        description: 生成结果的整体描述（可选）
        constraints: 建议的约束列表
        regex_suggestions: 建议的正则列表
    """

    table_name: str | None = Field(None, description="相关的表名")
    description: str | None = Field(None, description="生成结果的整体描述")
    constraints: list[AiConstraintSuggestion] = Field(default_factory=list, description="建议的约束列表")
    regex_suggestions: list[AiRegexSuggestion] = Field(default_factory=list, description="建议的正则列表")
