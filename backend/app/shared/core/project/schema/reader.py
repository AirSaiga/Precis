"""
@fileoverview 表结构读取模块

功能概述:
- 从 *.schema.yaml 文件读取表结构配置
- 返回 core 层的 TableSchemaFile 配置对象
- 运行时 TableSchema 对象的构建已迁移至 services.schema_runtime_builder，
  以避免 core 层反向依赖 domain 层。

架构设计:
- 单一职责: 仅负责 Schema 文件读取和基础配置解析
- 依赖注入: 使用 YAML 读取工具进行文件解析
- 类型安全: 使用 Pydantic 模型验证确保配置有效

输入示例:
    # users.schema.yaml
    version: 2
    id: users
    name: users
    source:
      mode: relative_file
      path: data/users.xlsx
    columns:
      - id: user_id
        name: user_id
        type: string

输出示例:
    schema_file = load_schema("schemas/users.schema.yaml")
    # schema_file 是 TableSchemaFile 对象，可交由 services 层转换为运行时对象
"""

from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from app.shared.core.io.yaml import read_yaml

from .types import TableSchemaFile


def load_schema(schema_path: str | Path) -> TableSchemaFile:
    """
    @methoddesc 从 YAML 文件加载表结构配置。

    ============================================================================
    配置文件示例 (本函数处理的配置文件长这样)
    ============================================================================
    本函数处理以下格式的 *.schema.yaml 文件：

    ```yaml
    # ============================================================
    # 表结构配置文件 (*.schema.yaml)
    # ============================================================

    version: 2

    id: users

    name: users

    source:
      mode: relative_file
      path: data/users.xlsx
      sheet: Sheet1
      header_row: 0

    columns:
      - id: user_id
        name: user_id
        type: string
        primary_key: true
        expand: false
      - id: email
        name: email
        type: string
        primary_key: false

    constraints:
      - id: email_notnull
        type: NotNull
        column: email
        enabled: true

    script_checks: []
    ```

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 加载表结构进行数据校验
      系统需要读取表结构配置来获取列定义和数据源信息。

    - 场景2: 构建运行时数据模型
      需要将配置文件转换为运行时对象供校验引擎使用。
      运行时转换请使用 app.shared.services.schema_runtime_builder。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - schema_path: str | Path，schema 文件路径
        示例值: "schemas/users.schema.yaml"

    处理步骤:
      路径标准化 -> YAML 解析 -> Pydantic 验证 -> TableSchemaFile 对象

    最终输出: TableSchemaFile 对象
      示例:
        schema = load_schema("schemas/users.schema.yaml")
        print(schema.name)  # 输出: users
        print(len(schema.columns))  # 输出: 2

    ============================================================================
    异常处理
    ============================================================================
    | 异常类型 | 触发条件 | 处理方式 |
    |---------|---------|---------|
    | ValueError | 文件不存在 | 检查文件路径 |
    | ValueError | YAML 格式错误 | 验证 YAML 文件 |
    | ValueError | 验证失败 | 检查配置格式 |

    :param schema_path: schema 文件路径
    :return: TableSchemaFile 对象
    :raises ValueError: 文件不存在或格式错误
    """
    path = Path(schema_path)
    raw = read_yaml(path)

    try:
        return TableSchemaFile.model_validate(raw)
    except ValidationError as e:
        raise ValueError(f"schema 校验失败: {path}\n{e}") from e


def schema_column_name_by_id(schema: TableSchemaFile) -> dict[str, str]:
    """
    @methoddesc 构建列 ID 到列名的映射。

    :param schema: TableSchemaFile 对象
    :return: Dict[str, str]，列 ID -> 列名 映射
    """
    return {c.id: c.name for c in schema.columns}


def schema_column_id_by_name(schema: TableSchemaFile) -> dict[str, str]:
    """
    @methoddesc 构建列名到列 ID 的映射。

    :param schema: TableSchemaFile 对象
    :return: Dict[str, str]，列名 -> 列 ID 映射
    """
    return {c.name: c.id for c in schema.columns}
