"""
@fileoverview Schema 类型定义模块

功能概述:
- 定义 V2 版本配置格式的 Pydantic 数据模型（V2Schema）
- 提供影响分析结果类型（ImpactAnalysisResult）

架构设计:
- 使用 Pydantic BaseModel 定义数据模型，自动完成数据校验和序列化
- V2Schema 对应 project.precis.yaml 的完整结构
- ImpactAnalysisResult 用于配置变更影响分析接口的响应

输入示例:
    schema = V2Schema(
        version=2,
        project={"id": "demo", "name": "Demo Project"},
        settings={"validation": {"auto_validate": True}},
        schemas=[{"id": "users", "path": "schemas/users.schema.yaml"}],
        constraints=[{"id": "unique_email", "path": "constraints/unique_email.constraint.yaml"}],
        regex_nodes=[{"id": "phone", "path": "regex/phone.regex.yaml"}],
        patterns_dir="patterns",
    )

输出示例:
    schema.dict() -> {
        "version": 2,
        "project": {"id": "demo", "name": "Demo Project"},
        "settings": {"validation": {"auto_validate": True}},
        "schemas": [...],
        "constraints": [...],
        "regex_nodes": [...],
        "patterns_dir": "patterns",
    }
"""

from typing import Any

from pydantic import BaseModel, Field


class V2Schema(BaseModel):
    """
    @classdesc V2 版本的 Schema 配置模型。

    字段说明:
        - version: 配置格式版本号，当前固定为 2
        - project: 项目基本信息字典，包含 id、name 等
        - settings: 项目设置字典，包含校验行为、文件处理、脚本安全等配置
        - schemas: Schema 引用列表，每个元素包含 id 和 path
        - constraints: Constraint 引用列表，每个元素包含 id 和 path
        - regex_nodes: Regex 节点引用列表，每个元素包含 id 和 path
        - patterns_dir: 预定义正则模式存放的目录路径

    使用场景:
        用于解析和校验 project.precis.yaml 配置文件的结构化数据
    """

    version: int = Field(2, description="配置版本")
    project: dict[str, Any] = Field(default_factory=dict, description="项目信息")
    settings: dict[str, Any] = Field(default_factory=dict, description="项目设置")
    schemas: list[dict[str, Any]] = Field(default_factory=list, description="Schema 引用列表")
    constraints: list[dict[str, Any]] = Field(default_factory=list, description="Constraint 引用列表")
    regex_nodes: list[dict[str, Any]] = Field(default_factory=list, description="Regex 节点引用列表")
    patterns_dir: str = Field("patterns", description="patterns 目录")


class ImpactAnalysisResult(BaseModel):
    """
    @classdesc 影响分析结果模型。

    字段说明:
        - summary: 分析摘要信息字典
        - changes: 检测到的变更列表，每项为一个变更描述字典
        - risks: 识别到的风险列表，每项为一个风险描述字典
        - recommendations: 给出的建议列表，每项为一个建议描述字典

    使用场景:
        用于 AI 配置生成或配置变更分析接口，返回变更影响的结构化分析结果
    """

    summary: dict[str, Any] = Field(default_factory=dict, description="摘要")
    changes: list[dict[str, Any]] = Field(default_factory=list, description="变更列表")
    risks: list[dict[str, Any]] = Field(default_factory=list, description="风险列表")
    recommendations: list[dict[str, Any]] = Field(default_factory=list, description="建议列表")
