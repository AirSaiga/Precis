"""
@fileoverview 功能/转换节点配置模块

功能概述:
- 定义 Transform 节点的数据模型 (TransformFile)
- 支持 StringSplit、RegexExtract、MathExpr、DateFormat 等转换类型
- 使用 Pydantic BaseModel 进行数据验证

架构设计:
- 统一入口: TransformFile 作为所有功能节点的根模型
- 类型区分: type 字段标识具体转换逻辑
- 参数灵活: params 为 Dict，各子类型自行定义内部结构

输入示例:
    TransformFile(
        version=2,
        id="split_id_card",
        type="StringSplit",
        input_from_node="source_users_01",
        input_column="id_card",
        params={
            "strategy": "fixed_position",
            "ranges": [
                {"name": "region_code", "start": 0, "end": 6},
                {"name": "birth_date", "start": 6, "end": 14},
            ]
        },
        output_columns=["region_code", "birth_date"]
    )
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class TransformFile(BaseModel):
    """
    @classdesc 单条功能/转换节点文件内容。

    支持类型（22 种）:
    - 多列输出: StringSplit, RegexExtract
    - 单列输出（行数不变）: MathExpr, DateFormat, Lookup, Strip, UpperCase, LowerCase,
      Replace, FillNA, CastType, Concat, Substring, ConditionalAssign,
      Digits, WeightedSum, Modulo, MapValue
    - 行数改变（暂无后端运行器）: FilterRows, DropDuplicates, Aggregate, SortRows

    输入接口:
    - input_from_node: 上游节点 ID（优先）
    - input_column: 上游节点中的目标列名

    输出接口:
    - output_columns: 转换后产生的列名列表
    """

    version: int = Field(2, description="配置版本号（固定为 2）")
    id: str = Field(..., description="转换节点 ID（稳定标识）")
    type: Literal[
        "StringSplit",
        "RegexExtract",
        "MathExpr",
        "DateFormat",
        "Lookup",
        "Strip",
        "UpperCase",
        "LowerCase",
        "Replace",
        "FillNA",
        "FilterRows",
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
    ] = Field(..., description="转换类型")
    enabled: bool = Field(True, description="是否启用")
    description: str | None = Field(None, description="描述")

    # 输入接口
    input_from_node: str | None = Field(None, description="上游数据流节点 ID")
    input_column: str | None = Field(None, description="上游节点中的目标列名")

    # 功能参数（因类型而异，各子类型自行约定结构）
    params: dict[str, Any] = Field(default_factory=dict, description="转换参数（因类型而异）")

    # 输出定义
    output_columns: list[str] = Field(default_factory=list, description="转换后产生的列名列表")


# 兼容别名
TransformFileV2 = TransformFile
