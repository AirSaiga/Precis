"""
@fileoverview Manifest 引用类型定义模块

功能概述:
- 定义 manifest 文件中对其他配置文件的引用结构
- 包括 Schema、Constraint、Regex 三种引用类型

架构设计:
- 轻量级引用: 仅包含 ID 和路径，不包含完整内容
- 延迟加载: 实际内容在后续步骤加载

输入示例 (manifest.yaml):
    version: 2
    schemas:
      - id: users           # SchemaRef.id
        path: schemas/users.yaml  # SchemaRef.path
      - id: orders
        path: schemas/orders.yaml
    constraints:
      - id: users_not_null
        path: constraints/users_not_null.yaml
    regex_nodes:
      - id: email_pattern
        path: regex/email.yaml

输出示例 (Python 对象):
    # SchemaRef 对象
    SchemaRef(id="users", path="schemas/users.yaml")

    # ConstraintRef 对象
    ConstraintRef(id="users_not_null", path="constraints/users_not_null.yaml")

    # RegexRef 对象
    RegexRef(id="email_pattern", path="regex/email.yaml")
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SchemaRef(BaseModel):
    """@classdesc Schema 文件引用

    用于在 manifest.yaml 中引用一个 Schema 配置文件。

    字段说明:
        - id: Schema 的唯一标识符，应与 schema 文件内部的 id 字段一致
        - path: 相对于 manifest.yaml 所在目录的路径

    示例:
        # manifest.yaml 中的定义
        schemas:
          - id: users
            path: schemas/users.yaml

        # 对应的 Python 对象
        SchemaRef(id="users", path="schemas/users.yaml")
    """

    id: str = Field(..., description="表 ID（与 schema 文件内 id 一致）")
    path: str = Field(..., description="schema 文件相对路径（相对于 manifest 所在目录）")


class ConstraintRef(BaseModel):
    """@classdesc Constraint 文件引用

    用于在 manifest.yaml 中引用一个 Constraint 配置文件。

    示例:
        # manifest.yaml 中的定义
        constraints:
          - id: users_not_null
            path: constraints/users_not_null.yaml

        # 对应的 Python 对象
        ConstraintRef(id="users_not_null", path="constraints/users_not_null.yaml")
    """

    id: str = Field(..., description="约束 ID（与 constraint 文件内 id 一致）")
    path: str = Field(..., description="constraint 文件相对路径（相对于 manifest 所在目录）")


class RegexRef(BaseModel):
    """@classdesc Regex 节点文件引用

    用于在 manifest.yaml 中引用一个 Regex 节点配置文件。

    示例:
        # manifest.yaml 中的定义
        regex_nodes:
          - id: email_pattern
            path: regex/email.yaml

        # 对应的 Python 对象
        RegexRef(id="email_pattern", path="regex/email.yaml")
    """

    id: str = Field(..., description="Regex 节点 ID（与 regex 文件内 id 一致）")
    path: str = Field(..., description="regex 文件相对路径（相对于 manifest 所在目录）")


class TransformRef(BaseModel):
    """@classdesc Transform 节点文件引用

    用于在 manifest.yaml 中引用一个 Transform 功能节点配置文件。

    示例:
        # manifest.yaml 中的定义
        transforms:
          - id: split_id_card
            path: transforms/split_id_card.transform.yaml

        # 对应的 Python 对象
        TransformRef(id="split_id_card", path="transforms/split_id_card.transform.yaml")
    """

    id: str = Field(..., description="Transform 节点 ID（与 transform 文件内 id 一致）")
    path: str = Field(..., description="transform 文件相对路径（相对于 manifest 所在目录）")
