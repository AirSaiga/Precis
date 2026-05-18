"""
@fileoverview 配置文件加载器适配模块

功能概述:
- 为项目加载器提供统一的文件加载接口
- 封装 Schema、Constraint、Regex 节点的底层读取逻辑
- 保持各类型配置文件加载接口的一致性

架构设计:
- 薄适配层: 仅做函数转发，不做额外业务处理
- 统一接口: 提供 load_schema_file / load_constraint_file / load_regex_node_file
- 委托模式: 将实际加载逻辑委托给各子模块的 reader

输入示例:
    # schema 文件路径
    schema_path = Path("/path/to/project/schemas/users.yaml")

    # users.yaml 内容:
    # id: users
    # name: 用户表
    # columns:
    #   - id: col_1
    #     name: id
    #     type: integer
    #     primary_key: true

输出示例:
    # TableSchemaFile 对象
    TableSchemaFile(
        id="users",
        name="用户表",
        columns=[
            Column(id="col_1", name="id", type="integer", primary_key=True)
        ]
    )

异常处理:
    - FileNotFoundError: 文件不存在
    - yaml.YAMLError: YAML 格式错误
    - ValidationError: 数据验证失败
"""

from __future__ import annotations

from pathlib import Path

# 导入各子模块的读取函数和类型，用于委托实际加载工作
from app.shared.core.project.constraint.reader import load_constraint
from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.regex.reader import load_regex_node
from app.shared.core.project.regex.types import RegexNodeFile
from app.shared.core.project.schema.reader import load_schema
from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.core.project.transform.reader import load_transform
from app.shared.core.project.transform.types import TransformFile


def load_schema_file(schema_path: Path) -> TableSchemaFile:
    """@methoddesc 加载 Schema 配置文件

    输入示例:
        schema_path = Path("/path/to/project/schemas/users.yaml")

        # 文件内容:
        # id: users
        # name: 用户表
        # columns:
        #   - id: col_1
        #     name: id
        #     type: integer
        #     primary_key: true
        #   - id: col_2
        #     name: username
        #     type: string
        #     nullable: false

    输出示例:
        TableSchemaFile(
            id="users",
            name="用户表",
            columns=[
                Column(id="col_1", name="id", type="integer", primary_key=True),
                Column(id="col_2", name="username", type="string", nullable=False)
            ]
        )
    """
    # 委托给 schema.reader 模块完成实际的 YAML 读取与验证
    return load_schema(schema_path)


def load_constraint_file(constraint_path: Path) -> ConstraintFile:
    """@methoddesc 加载 Constraint 配置文件

    输入示例:
        constraint_path = Path("/path/to/project/constraints/not_null_username.yaml")

        # 文件内容:
        # id: users_not_null_username
        # type: NotNull
        # enabled: true
        # refs:
        #   table_id: users
        #   column_id: username
        # params: {}

    输出示例:
        ConstraintFile(
            id="users_not_null_username",
            type="NotNull",
            enabled=True,
            refs={"table_id": "users", "column_id": "username"},
            params={}
        )
    """
    # 委托给 constraint.reader 模块完成实际的 YAML 读取与验证
    return load_constraint(constraint_path)


def load_regex_node_file(regex_path: Path) -> RegexNodeFile:
    r"""
    @methoddesc 加载 Regex 节点配置文件

    输入示例:
        regex_path = Path("/path/to/project/regex/email.yaml")

        # 文件内容:
        # id: email_regex
        # name: 邮箱正则
        # pattern: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$
        # flags: []

    输出示例:
        RegexNodeFile(
            id="email_regex",
            name="邮箱正则",
            pattern="^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
            flags=[]
        )
    """
    # 委托给 regex.reader 模块完成实际的 YAML 读取与验证
    return load_regex_node(regex_path)


def load_transform_file(transform_path: Path) -> TransformFile:
    """@methoddesc 加载 Transform 配置文件

    输入示例:
        transform_path = Path("/path/to/project/transforms/split.yaml")

        # 文件内容:
        # version: 2
        # id: split_name
        # type: StringSplit
        # enabled: true
        # input_column: full_name
        # params:
        #   delimiter: " "
        # output_columns: [first_name, last_name]

    输出示例:
        TransformFile(
            version=2,
            id="split_name",
            type="StringSplit",
            enabled=True,
            input_column="full_name",
            params={"delimiter": " "},
            output_columns=["first_name", "last_name"]
        )
    """
    return load_transform(transform_path)
