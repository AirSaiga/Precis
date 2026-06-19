"""
@fileoverview 运行时数据结构构建辅助模块

功能概述:
- 构建 patterns 注册表
- 将 ConstraintFile 批量转换为运行时约束对象的薄包装

架构设计:
- 类型转换层: config -> domain object
- 列类型 / DataSetSchema 的转换已迁移至 services 层，避免 core 反向依赖 domain
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.shared.core.patterns.loader import load_patterns_from_config
from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.schema.types import TableSchemaFile

from .path_validation import validate_path_inside_project


def build_runtime_constraints(constraint_files: dict[str, ConstraintFile], schema_files: dict[str, TableSchemaFile]):
    """@methoddesc 构建运行时约束对象（代理函数）

    该函数是约束工厂模块 create_constraints 的薄包装，
    负责将 ConstraintFile 配置批量转换为运行时约束实例。

    输入示例:
        constraint_files = {
            "unique_email": ConstraintFile(
                id="unique_email",
                type="Unique",
                refs={"table_id": "users", "column_ids": ["email"]}
            )
        }
        schema_files = {"users": TableSchemaFile(...)}

    输出示例:
        ([UniqueConstraint(...)], [])  # (约束实例列表, 警告列表)
    """
    # 导入并委托给 constraint.factory 完成实际的约束实例化
    from app.shared.core.project.constraint.factory import create_constraints

    return create_constraints(constraint_files, schema_files)


# ============================================================================
# Patterns 注册表构建（原 registries.py，合并至此以减少碎片化文件）
# ============================================================================


def build_registries(project_root: Path, manifest: object) -> dict[str, Any]:
    """@methoddesc 构建 Patterns 注册表

    从 manifest.patterns_dir 指定的目录加载表达式模式。

    输入示例:
        project_root = Path("/path/to/project")
        manifest = Manifest(
            version="2",
            patterns_dir="patterns",
            schemas=[...],
            constraints=[...]
        )

        # patterns 目录内容:
        # patterns/
        #   └── math.yaml
        #       ---
        #       - name: add
        #         pattern: "{a} + {b}"
        #         returns: integer

    输出示例:
        registries = {
            "expression_registry": ExpressionRegistry(
                patterns={
                    "math": [
                        Pattern(name="add", pattern="{a} + {b}", returns="integer")
                    ]
                }
            )
        }

    原理说明:
        - load_patterns_from_config() 会递归扫描 patterns_dir 下所有 .yaml 文件
        - 每个文件对应一个命名空间 (namespace)
        - 表达式在验证时可以通过 namespace.name 引用
    """
    # 根据 manifest 中配置的 patterns_dir 计算绝对路径
    patterns_dir = project_root / manifest.patterns_dir
    registries: dict[str, Any] = {}
    # 验证 patterns 目录是否在项目根目录范围内，防止目录遍历
    try:
        validate_path_inside_project(project_root, patterns_dir, "patterns 目录")
    except ValueError:
        # 如果路径验证失败，返回空的表达式注册表，避免阻塞后续加载
        return {"expression_registry": None}
    # 目录存在时加载所有模式文件；不存在则返回 None
    if patterns_dir.exists():
        registries["expression_registry"] = load_patterns_from_config(str(patterns_dir))
    else:
        registries["expression_registry"] = None
    return registries
