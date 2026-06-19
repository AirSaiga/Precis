"""
@fileoverview core/domain 解耦专项测试

验证 backend-core-domain-decouple 任务的改动：
1. core.data_source.loader 不再直接依赖 domain.TableSchema，而是使用 DataSourceInfo DTO
2. core.project.constraint.registry 通过字符串路径延迟解析 domain 约束类
3. services.project_loader 负责将 core 配置对象转换为 domain DataSetSchema
"""

from __future__ import annotations

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd

from app.shared.core.data_source.loader import load_grouped_sources
from app.shared.core.data_source.schema_info import DataSourceInfo
from app.shared.core.project.constraint.registry import (
    CONSTRAINT_REGISTRY,
    resolve_constraint_class,
)
from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile
from app.shared.domain import DataSetSchema
from app.shared.services.project_loader import build_dataset_schema


class TestDataSourceInfoDecouple:
    """数据源加载器使用 DataSourceInfo DTO，不与 domain.TableSchema 耦合。"""

    def test_load_csv_with_data_source_info(self, tmp_path):
        csv_file = tmp_path / "users.csv"
        csv_file.write_text("id,name\n1,alice\n", encoding="utf-8")

        info = DataSourceInfo(schema_id="users", header_row=0)
        datasets, errors = load_grouped_sources({str(csv_file): [info]})

        assert len(errors) == 0
        assert "users" in datasets
        assert isinstance(datasets["users"], pd.DataFrame)
        assert list(datasets["users"].columns) == ["id", "name"]

    def test_data_source_info_keeps_source_config(self, tmp_path):
        """DTO 应完整透传 source_config 给底层加载器（如 JSON format）。"""
        json_file = tmp_path / "data.json"
        json_file.write_text('[{"id": 1, "name": "alice"}]', encoding="utf-8")

        info = DataSourceInfo(schema_id="users", source_config={"format": "array"})
        datasets, errors = load_grouped_sources({str(json_file): [info]})

        assert len(errors) == 0
        assert "users" in datasets


class TestConstraintRegistryDecouple:
    """约束注册表通过导入路径字符串延迟解析 domain 类，避免 core 静态依赖 domain。"""

    def test_registry_values_are_import_paths(self):
        for path in CONSTRAINT_REGISTRY.values():
            assert isinstance(path, str)
            assert "." in path

    def test_resolve_constraint_class_returns_domain_class(self):
        cls = resolve_constraint_class("Unique")
        assert cls is not None
        assert cls.__name__ == "UniqueConstraint"

        cls = resolve_constraint_class("NotNull")
        assert cls is not None
        assert cls.__name__ == "NotNullConstraint"

    def test_resolve_unknown_constraint_class_returns_none(self):
        assert resolve_constraint_class("UnknownType") is None


class TestProjectLoaderDecouple:
    """services.project_loader 负责 core -> domain 的转换。"""

    def test_build_dataset_schema_converts_to_domain(self):
        schema_files = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[ColumnSpec(id="email", name="email", type="string")],
                source={"mode": "relative_file", "path": "data/users.csv", "header_row": 0},
            )
        }
        constraint_files = {
            "nn_email": ConstraintFile(
                version=2,
                id="nn_email",
                type="NotNull",
                enabled=True,
                refs={"table_id": "users", "column_id": "email"},
            )
        }

        dataset_schema, warnings = build_dataset_schema(schema_files, constraint_files, {})

        assert isinstance(dataset_schema, DataSetSchema)
        assert "users" in dataset_schema.tables
        assert len(dataset_schema.constraints) == 1
        assert len(warnings) == 0
