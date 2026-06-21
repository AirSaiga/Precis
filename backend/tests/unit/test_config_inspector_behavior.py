"""
@fileoverview 配置自检行为测试

覆盖 ID 一致性、引用完整性、默认动作生成。
"""

from __future__ import annotations

from pathlib import Path

from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.loader.loader_parts.config_inspector import (
    _default_actions_for_file,
    inspect_config,
)
from app.shared.core.project.loader.types import LoadingError
from app.shared.core.project.manifest.types import ConstraintRef, ProjectInfo, ProjectManifest, SchemaRef
from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile


class TestConfigInspector:
    """配置自检行为"""

    def _make_column(self, col_id: str, name: str) -> ColumnSpec:
        # 测试工厂仅使用业务相关字段，共享模型字段由其他任务维护；忽略 mypy 参数缺失提示。
        return ColumnSpec(id=col_id, name=name, type="string")

    def _make_schema(self, table_id: str, name: str, columns: list[ColumnSpec]) -> TableSchemaFile:
        return TableSchemaFile(id=table_id, name=name, columns=columns)

    def test_id_mismatch_schema_generates_warning(self):
        col = self._make_column("c1", "name")
        schema_file = self._make_schema("real_id", "Test", [col])
        manifest = ProjectManifest(
            project=ProjectInfo(id="p", name="P"),
            schemas=[SchemaRef(id="manifest_id", path="schemas/test.schema.yaml")],
        )
        warnings: list[str] = []
        errors: list[LoadingError] = []

        inspect_config(Path("."), manifest, {"manifest_id": schema_file}, {}, {}, {}, {}, warnings, errors)

        assert len(warnings) == 1
        assert "ID 不一致" in warnings[0]
        assert any(e.error_type == "IdMismatchWarning" for e in errors)

    def test_reference_integrity_missing_table(self):
        col = self._make_column("c1", "name")
        schema_file = self._make_schema("users", "Users", [col])
        constraint = ConstraintFile(
            id="nn_1",
            type="NotNull",
            refs={"table_id": "ghost_table", "column_id": "c1"},
        )
        manifest = ProjectManifest(
            project=ProjectInfo(id="p", name="P"),
            schemas=[SchemaRef(id="users", path="schemas/users.schema.yaml")],
            constraints=[ConstraintRef(id="nn_1", path="constraints/nn_1.constraint.yaml")],
        )
        warnings: list[str] = []
        errors: list[LoadingError] = []

        inspect_config(
            Path("."),
            manifest,
            {"users": schema_file},
            {"nn_1": constraint},
            {},
            {},
            {},
            warnings,
            errors,
        )

        assert any(e.error_type == "ReferenceIntegrityError" for e in errors)
        assert any("ghost_table" in w for w in warnings)

    def test_reference_integrity_missing_column(self):
        col = self._make_column("c1", "name")
        schema_file = self._make_schema("users", "Users", [col])
        constraint = ConstraintFile(
            id="nn_1",
            type="NotNull",
            refs={"table_id": "users", "column_id": "missing_col"},
        )
        manifest = ProjectManifest(
            project=ProjectInfo(id="p", name="P"),
            schemas=[SchemaRef(id="users", path="schemas/users.schema.yaml")],
            constraints=[ConstraintRef(id="nn_1", path="constraints/nn_1.constraint.yaml")],
        )
        warnings: list[str] = []
        errors: list[LoadingError] = []

        inspect_config(
            Path("."),
            manifest,
            {"users": schema_file},
            {"nn_1": constraint},
            {},
            {},
            {},
            warnings,
            errors,
        )

        assert any(e.error_type == "ReferenceIntegrityError" for e in errors)
        assert any("missing_col" in w for w in warnings)

    def test_default_actions_for_file(self):
        actions = _default_actions_for_file("schemas/test.schema.yaml", ref_id="sc_1", include_dismiss=True)
        assert len(actions) == 4
        assert actions[0]["type"] == "open_file"
        assert actions[-1]["type"] == "dismiss"

    def test_default_actions_no_file_no_dismiss(self):
        actions = _default_actions_for_file("", None, include_dismiss=False)
        assert actions == []
