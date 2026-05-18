"""
@fileoverview 表头行变更处理路由模块

功能概述:
- 接收并处理表头行变更事件
- 将新的表头行信息持久化到对应的 Schema YAML 文件
- 记录变更时间戳和节点关联信息

架构设计:
- 基于 FastAPI APIRouter 组织路由
- 直接操作本地 YAML Schema 配置文件
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

import yaml

from app.api.models import HeaderRowChangedRequest, HeaderRowChangedResponse
from app.shared.core.io.yaml import write_yaml_atomic

from .router import router


@router.post("/header-row-changed", response_model=HeaderRowChangedResponse)
def handle_header_row_changed(request: HeaderRowChangedRequest):
    """
    处理表头行变更请求。

    接收前端传来的表头行变更事件，将新的表头行索引和关联信息
    持久化到对应的 Schema YAML 文件中。

    参数:
        request: 表头行变更请求，包含 node_id、header_row、schema_name 等信息

    返回:
        HeaderRowChangedResponse: 变更处理结果，包含成功状态和消息

    业务逻辑:
        1. 提取请求中的 node_id、header_row、schema_name 等字段
        2. 如果指定了 schema_name，尝试更新对应的 Schema YAML 文件
        3. 在 Schema 文件中记录 header_row.index、node_id 和 updated_at
        4. 如果提供了 row_data，一并保存
        5. 返回操作结果
    """
    try:
        node_id = request.node_id
        header_row = request.header_row
        _old_header_row = request.old_header_row
        row_data = request.row_data
        schema_name = request.schema_name

        if schema_name:
            schema_path = Path("schemas") / f"{schema_name}.yaml"

            if os.path.exists(schema_path):
                try:
                    with open(schema_path, encoding="utf-8") as f:
                        schema_content = yaml.safe_load(f)

                    if "header_row" not in schema_content:
                        schema_content["header_row"] = {}

                    schema_content["header_row"]["index"] = header_row
                    schema_content["header_row"]["node_id"] = node_id
                    schema_content["header_row"]["updated_at"] = datetime.now().isoformat()

                    if row_data:
                        schema_content["header_row"]["data"] = row_data

                    write_yaml_atomic(Path(schema_path), schema_content)

                    return HeaderRowChangedResponse(
                        success=True,
                        message=f"表头行已更新到第{header_row}行",
                        schema_name=schema_name,
                        updated_at=datetime.now().isoformat(),
                    )

                except Exception as e:
                    return HeaderRowChangedResponse(
                        success=False,
                        message=f"更新Schema文件失败: {str(e)}",
                        schema_name=schema_name,
                        updated_at=datetime.now().isoformat(),
                    )

        return HeaderRowChangedResponse(
            success=True,
            message=f"表头行变更事件已接收，node_id: {node_id}, header_row: {header_row}",
            schema_name=schema_name or "",
            updated_at=datetime.now().isoformat(),
        )

    except Exception as e:
        return HeaderRowChangedResponse(
            success=False,
            message=f"处理表头行变更时发生错误: {str(e)}",
            schema_name=request.schema_name or "",
            updated_at=datetime.now().isoformat(),
        )
