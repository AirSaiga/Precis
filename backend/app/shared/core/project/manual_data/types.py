"""
@fileoverview ManualData 节点配置类型定义

功能概述:
- 定义 ManualData 节点的数据模型 (ManualDataFile)
- 支持单列内联数据的持久化

架构设计:
- ManualDataFile 对应 manual_data/{id}.yaml 配置文件
- 在 manifest 中通过 ManualDataRef 引用
- 模板展开时，模板内 manualData 节点展开为 ManualDataFile

输入示例:
    ManualDataFile(
        version=2,
        id="ti1__md1",
        column_name="age",
        column_data_type="integer",
        rows=[["18"], ["25"], ["65"]],
    )
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ManualDataFile(BaseModel):
    """@classdesc ManualData 节点文件内容

    用于持久化画布上的内联测试数据节点。
    manualData 是单列数据节点，rows 为二维数组（每行一个字段）。

    字段说明:
        - version: 配置版本号（固定为 2）
        - id: 节点 ID（与 manifest ref id 一致）
        - column_name: 列名
        - column_data_type: 列数据类型
        - rows: 二维字符串数组，每行一个字段值
        - enabled: 是否启用
        - description: 描述
        - input_from_node: 上游节点 ID（当从 Schema 列注入数据时设置）
    """

    version: int = Field(2, description="配置版本号（固定为 2）")
    id: str = Field(..., description="节点 ID（与 manifest ref id 一致）")
    column_name: str = Field("Column1", description="列名")
    column_data_type: Literal["string", "integer", "float", "decimal", "boolean", "date"] = Field(
        "string", description="列数据类型"
    )
    rows: list[list[str]] = Field(default_factory=list, description="二维字符串数组，每行一个字段值")
    enabled: bool = Field(True, description="是否启用")
    description: str | None = Field(None, description="描述")
    input_from_node: str | None = Field(None, description="上游节点 ID（当从 Schema 列注入数据时设置）")


# 兼容别名
ManualDataFileV2 = ManualDataFile
