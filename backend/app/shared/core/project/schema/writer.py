"""
@fileoverview 表结构写入模块

功能概述:
- 写入 *.schema.yaml 文件
- 优化字段顺序，提升 YAML 可读性

架构设计:
- 唯一入口: 封装 Pydantic 模型到 YAML 文件的转换逻辑
- 字段排序: 按重要程度分组（核心 / 可选 / 内部）
- 懒加载: ensure_schema_file 提供内存中创建或获取 Schema 对象的能力

输入示例:
    schema = TableSchemaFile(
        version=2,
        id="users",
        name="users",
        source=SourceSpec(mode="relative_file", path="data/users.xlsx"),
        columns=[ColumnSpec(id="user_id", name="user_id", type="string")],
    )

输出示例:
    save_schema(schema, "schemas/users.schema.yaml")
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from app.shared.core.io.yaml import write_yaml

from .types import TableSchemaFile

if TYPE_CHECKING:
    from .types import TableSchemaFile


def save_schema(schema: TableSchemaFile, schema_path: str | Path) -> None:
    """
    @methoddesc 保存表结构到 YAML 文件。

    字段顺序优化（按重要程度分组）：
    L1（核心）：name, source, columns
    L2（可选）：primary_key（通过 columns 内字段）
    L3（内部）：version, id, _internal

    处理流程：
    1. 将 TableSchemaFile 对象序列化为字典（model_dump）
    2. 按重要程度重新组织字段顺序
    3. 从 id 提取 sheet 名并写入 source（如果 source 存在但 sheet 为空）
    4. 写入 YAML 文件

    :param schema: TableSchemaFile 对象，包含表的完整结构定义
    :param schema_path: 保存路径，可以是相对路径或绝对路径
    :raises IOError: 文件写入失败时抛出
    """
    # 步骤1：将 Pydantic 模型序列化为字典
    # model_dump() 会包含所有字段，包括默认值
    data = schema.model_dump()

    # 步骤2：按重要程度重新组织字段顺序
    # 核心字段放在前面，提升 YAML 可读性
    ordered = {
        # L1 - 核心字段（用户最常编辑）
        "name": data["name"],  # 表名，核心标识
        "source": data.get("source"),  # 数据源配置
        "columns": data.get("columns", []),  # 列定义列表
        # L2 - 可选配置（通过 _internal）
        "version": data["version"],  # 配置版本号
        "id": data["id"],  # 表唯一标识
        "_internal": data.get("_internal", {}),  # 内部元数据
    }

    # source 已包含完整的 sheet 信息，无需从 ID 提取
    # 旧版从 ID 解码 sheet 的逻辑已移除

    # 步骤4：调用底层 YAML 写入工具
    write_yaml(Path(schema_path), ordered)


def ensure_schema_file(
    schema_files: dict[str, TableSchemaFile],
    table_id: str,
    name: str,
    columns: list | None = None,
    source: dict | None = None,
) -> TableSchemaFile:
    """
    @methoddesc 确保 schema_files 字典中包含指定 table_id 的 schema。
    如果不存在则创建新的 TableSchemaFile。

    处理流程：
    1. 检查 schema_files 字典中是否已存在对应 table_id 的 Schema
    2. 如存在，直接返回现有对象（复用）
    3. 如不存在，创建新的 TableSchemaFile 并存入字典

    使用场景：
    - 项目初始化时批量创建 Schema
    - 动态添加新的表结构
    - 避免重复创建相同的 Schema 对象

    :param schema_files: schema 文件字典，key 为 table_id，value 为 TableSchemaFile
    :param table_id: 表 ID，作为字典的 key 使用
    :param name: 表名，用于展示和校验
    :param columns: 列定义列表，每个元素为列配置的字典
    :param source: 数据源描述字典，包含 mode、path 等信息
    :return: TableSchemaFile 对象（已存在或新创建）
    """
    # 步骤1：检查是否已存在对应 table_id 的 Schema
    # 优先复用已有对象，避免重复创建
    if table_id in schema_files:
        return schema_files[table_id]

    # 步骤2：导入必要的类型，用于构建对象
    from .types import ColumnSpec, SourceSpec, TableSchemaFile

    # 步骤3：构建新的 TableSchemaFile 对象
    # 使用字典解包方式创建列定义列表
    schema = TableSchemaFile.model_construct(
        id=table_id,
        name=name,
        # 将列配置字典列表转换为 ColumnSpec 对象列表
        columns=[ColumnSpec(**col) for col in (columns or [])],
        # 将源配置字典转换为 SourceSpec 对象
        source=SourceSpec(**source) if source else None,
    )

    # 步骤4：将新创建的 Schema 存入字典并返回
    schema_files[table_id] = schema
    return schema
