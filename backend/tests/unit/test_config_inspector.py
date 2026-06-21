"""
@fileoverview 配置自检模块单元测试

覆盖范围:
- inspect_config 主入口及 5 个子检查函数的输入→输出映射
- inspect_id_consistency: schema/constraint/regex/transform 四类 ID 不一致
- inspect_schema_id_global_uniqueness: 多 schema 复用同一 ID
- inspect_source_uniqueness: 多 schema 指向同一数据源
- inspect_reference_integrity: 各约束类型引用的表/列缺失
- inspect_regex_reference_integrity: 正则节点 source_ref 引用缺失
- 自动修复端点: fix-table-ref / fix-column-ref / fix-regex-table-ref / fix-regex-column-ref / fix-id-mismatch

测试原则:
- 测行为不测实现: 验证 loading_errors 的 severity/fix_api/title, 不验证内部函数调用
- 工厂函数集中维护 mock 数据
- 边界与正常路径成对覆盖
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.loader.loader_parts.config_inspector import (
    inspect_config,
    inspect_id_consistency,
    inspect_reference_integrity,
    inspect_regex_reference_integrity,
    inspect_schema_id_global_uniqueness,
    inspect_source_uniqueness,
)
from app.shared.core.project.loader.types import LoadingError
from app.shared.core.project.manifest.types import (
    ConstraintRef,
    ProjectInfo,
    ProjectManifest,
    RegexRef,
    SchemaRef,
    TransformRef,
)
from app.shared.core.project.regex.types import RegexNodeFile, RegexSourceRef
from app.shared.core.project.schema.types import ColumnSpec, SourceSpec, TableSchemaFile
from app.shared.core.project.transform.types import TransformFile

# ============================================================================
# 工厂函数 — 集中维护测试数据，禁止内联硬编码
# ============================================================================


def make_column(**overrides) -> ColumnSpec:
    """构造列定义。"""
    base = {"id": "id", "name": "id", "type": "integer"}
    return ColumnSpec(**(base | overrides))  # type: ignore[call-arg]


def make_schema(**overrides) -> TableSchemaFile:
    """构造 schema 文件对象。默认含 id/name 两列。"""
    base = {
        "id": "users",
        "name": "users",
        "columns": [
            ColumnSpec(id="id", name="id", type="integer"),  # type: ignore[call-arg]
            ColumnSpec(id="email", name="email", type="string"),  # type: ignore[call-arg]
        ],
    }
    return TableSchemaFile(**(base | overrides))  # type: ignore[call-arg]


def make_constraint(**overrides) -> ConstraintFile:
    """构造约束文件对象。默认 NotNull 作用于 users.email。"""
    base = {
        "id": "c_notnull_email",
        "type": "NotNull",
        "refs": {"table_id": "users", "column_id": "email"},
    }
    return ConstraintFile(**(base | overrides))  # type: ignore[call-arg]


def make_regex(**overrides) -> RegexNodeFile:
    """构造正则节点文件对象。默认指向 users.email。"""
    base = {
        "id": "r_email",
        "name": "邮箱正则",
        "pattern": r"^.+@.+$",
        "match_mode": "full",
        "source_ref": RegexSourceRef(table_id="users", column_id="email"),
    }
    return RegexNodeFile(**(base | overrides))  # type: ignore[call-arg, arg-type]


def make_transform(**overrides) -> TransformFile:
    """构造 transform 文件对象。"""
    base = {"id": "t_split", "name": "拆分", "type": "StringSplit"}
    return TransformFile(**(base | overrides))  # type: ignore[call-arg]


def make_manifest(**overrides) -> ProjectManifest:
    """构造项目清单。"""
    base = {
        "project": ProjectInfo(id="test-project", name="Test Project"),
        "schemas": [SchemaRef(id="users", path="schemas/users.schema.yaml")],
        "constraints": [],
        "regex_nodes": [],
        "transforms": [],
    }
    return ProjectManifest(**(base | overrides))  # type: ignore[call-arg, arg-type]


def run_inspect_id(manifest, schema_files, constraint_files, regex_files, transform_files, manual_data_files=None):
    """执行 inspect_id_consistency 并返回 (warnings, errors)。"""
    warnings: list[str] = []
    errors: list[LoadingError] = []
    inspect_id_consistency(
        manifest,
        schema_files,
        constraint_files,
        regex_files,
        transform_files,
        manual_data_files or {},
        warnings,
        errors,
    )
    return warnings, errors


# ============================================================================
# inspect_id_consistency 测试
# ============================================================================


class TestInspectIdConsistency:
    """manifest 引用 ID 与文件内部 ID 一致性检查。"""

    def test_all_consistent_no_errors(self):
        """全部一致时不应产生任何 error。"""
        manifest = make_manifest()
        schema_files = {"users": make_schema()}
        warnings, errors = run_inspect_id(manifest, schema_files, {}, {}, {})
        assert errors == []
        assert warnings == []

    def test_schema_id_mismatch_generates_warning(self):
        """manifest 引用 ID 与 schema 文件内部 id 不一致 → warning + fix_api。"""
        manifest = make_manifest(schemas=[SchemaRef(id="users_ref", path="schemas/users.schema.yaml")])
        # 文件内部 id 是 users，manifest 引用 users_ref → 不一致
        schema_files = {"users_ref": make_schema(id="users")}
        warnings, errors = run_inspect_id(manifest, schema_files, {}, {}, {})

        assert len(errors) == 1
        err = errors[0]
        assert err.severity == "warning"
        assert err.fix_api is not None
        assert err.fix_api["path"] == "/project/manifest/fix-id-mismatch"
        assert err.fix_api["body"]["resource_type"] == "schema"
        assert err.message_params["manifestId"] == "users_ref"
        assert err.message_params["fileId"] == "users"
        assert len(warnings) == 1

    def test_constraint_id_mismatch_simple_generates_warning(self):
        """constraint ID 不一致且无重复登记 → 走通用 mismatch 路径。"""
        manifest = make_manifest(constraints=[ConstraintRef(id="c_old", path="constraints/c.constraint.yaml")])
        constraint_files = {"c_old": make_constraint(id="c_new")}
        warnings, errors = run_inspect_id(manifest, {}, constraint_files, {}, {})

        assert len(errors) == 1
        assert errors[0].severity == "warning"
        assert errors[0].fix_api["body"]["resource_type"] == "constraint"

    def test_constraint_dup_ref_generates_deduplicate_fix(self):
        """同一条 constraint 被重复登记（一条 id 错） → 走 deduplicate 路径。"""
        manifest = make_manifest(
            constraints=[
                ConstraintRef(id="c_correct", path="constraints/c.constraint.yaml"),
                ConstraintRef(id="c_wrong", path="constraints/c.constraint.yaml"),
            ]
        )
        # manifest 用 c_correct 能找到文件, c_wrong 找不到对应 id
        constraint_files = {
            "c_correct": make_constraint(id="c_correct"),
            "c_wrong": make_constraint(id="c_correct"),  # 文件实际 id 是 c_correct
        }
        _, errors = run_inspect_id(manifest, {}, constraint_files, {}, {})

        # 应出现一条"重复登记"warning，其 fix_api 指向 deduplicate
        dup_errors = [
            e for e in errors if e.fix_api and e.fix_api.get("path") == "/project/manifest/constraint/deduplicate"
        ]
        assert len(dup_errors) == 1
        assert "重复" in dup_errors[0].title or "重复" in dup_errors[0].description

    def test_regex_and_transform_mismatch_handled(self):
        """regex/transform 的 ID 不一致也应有 fix_api。"""
        manifest = make_manifest(
            regex_nodes=[RegexRef(id="r_old", path="regex/r.regex.yaml")],
            transforms=[TransformRef(id="t_old", path="transforms/t.transform.yaml")],
        )
        regex_files = {"r_old": make_regex(id="r_new")}
        transform_files = {"t_old": make_transform(id="t_new")}
        _, errors = run_inspect_id(manifest, {}, {}, regex_files, transform_files)

        assert len(errors) == 2
        resource_types = {e.fix_api["body"]["resource_type"] for e in errors}
        assert resource_types == {"regex", "transform"}


# ============================================================================
# inspect_schema_id_global_uniqueness 测试
# ============================================================================


class TestInspectSchemaIdGlobalUniqueness:
    """检测多个 schema 复用同一 ID（blocker）。"""

    def test_unique_ids_no_error(self):
        errors: list[LoadingError] = []
        schema_files = {"s1": make_schema(id="users"), "s2": make_schema(id="orders")}
        inspect_schema_id_global_uniqueness(schema_files, errors)
        assert errors == []

    def test_duplicate_id_generates_blocker(self):
        errors: list[LoadingError] = []
        # 两个不同 manifest ref key，但文件内部 id 相同
        schema_files = {
            "ref_a": make_schema(id="users"),
            "ref_b": make_schema(id="users"),
        }
        inspect_schema_id_global_uniqueness(schema_files, errors)

        assert len(errors) == 1
        err = errors[0]
        assert err.severity == "blocker"
        assert err.error_type == "SchemaIdDuplicate"
        assert "users" in err.title
        # P2: 应携带 i18n key、message_params 与可执行 actions
        assert err.title_key == "inspection.issues.schemaIdDuplicate.title"
        assert err.message_params["schemaId"] == "users"
        assert err.message_params["count"] == 2
        # actions 应包含 navigate（定位到节点）和 dismiss（允许忽略）
        action_types = {a["type"] for a in err.actions}
        assert "navigate" in action_types
        assert "dismiss" in action_types
        # 无 fix_api（此类问题需用户手动决策，无法自动修复）
        assert err.fix_api is None


# ============================================================================
# inspect_source_uniqueness 测试
# ============================================================================


class TestInspectSourceUniqueness:
    """检测多个 schema 指向同一数据源（blocker）。"""

    def test_distinct_sources_no_error(self):
        errors: list[LoadingError] = []
        schema_files = {
            "users": make_schema(source=SourceSpec(mode="relative_file", path="data/users.xlsx")),
            "orders": make_schema(id="orders", source=SourceSpec(mode="relative_file", path="data/orders.xlsx")),
        }
        inspect_source_uniqueness(schema_files, errors)
        assert errors == []

    def test_same_source_different_sheet_no_error(self):
        """同文件不同 sheet 视为不同数据源。"""
        errors: list[LoadingError] = []
        schema_files = {
            "users": make_schema(source=SourceSpec(mode="relative_file", path="data/data.xlsx", sheet="Sheet1")),
            "orders": make_schema(
                id="orders", source=SourceSpec(mode="relative_file", path="data/data.xlsx", sheet="Sheet2")
            ),
        }
        inspect_source_uniqueness(schema_files, errors)
        assert errors == []

    def test_duplicate_source_generates_blocker(self):
        errors: list[LoadingError] = []
        schema_files = {
            "users": make_schema(source=SourceSpec(mode="relative_file", path="data/users.xlsx")),
            "dup": make_schema(id="dup", source=SourceSpec(mode="relative_file", path="data/users.xlsx")),
        }
        inspect_source_uniqueness(schema_files, errors)

        assert len(errors) == 1
        err = errors[0]
        assert err.severity == "blocker"
        assert err.error_type == "SchemaSourceDuplicate"
        # P2: 应携带 i18n key、message_params 与可执行 actions
        assert err.title_key == "inspection.issues.sourceDuplicate.title"
        assert err.message_params["count"] == 2
        assert "users.xlsx" in err.message_params["sourceDisplay"]
        action_types = {a["type"] for a in err.actions}
        assert "navigate" in action_types
        assert "dismiss" in action_types
        assert err.fix_api is None

    def test_schema_without_source_skipped(self):
        """没有 source 的 schema 不参与检查。"""
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}  # 无 source
        inspect_source_uniqueness(schema_files, errors)
        assert errors == []


# ============================================================================
# inspect_reference_integrity 测试
# ============================================================================


class TestInspectReferenceIntegrity:
    """约束引用完整性检查。"""

    def test_valid_references_no_error(self):
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        constraint_files = {"c1": make_constraint()}
        inspect_reference_integrity(schema_files, constraint_files, warnings, errors)
        assert errors == []

    def test_not_null_missing_table_generates_blocker(self):
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        constraint_files = {"c1": make_constraint(refs={"table_id": "ghost", "column_id": "email"})}
        inspect_reference_integrity(schema_files, constraint_files, warnings, errors)

        assert len(errors) == 1
        err = errors[0]
        assert err.severity == "blocker"
        assert err.error_type == "ReferenceIntegrityError"
        assert err.fix_api["path"] == "/project/inspection/fix-table-ref"
        assert err.fix_api["body"]["old_table_id"] == "ghost"
        # context 应含可用表列表
        assert len(err.context["available_schemas"]) == 1
        assert err.context["available_schemas"][0]["id"] == "users"

    def test_not_null_missing_column_generates_blocker(self):
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        constraint_files = {"c1": make_constraint(refs={"table_id": "users", "column_id": "ghost_col"})}
        inspect_reference_integrity(schema_files, constraint_files, warnings, errors)

        assert len(errors) == 1
        err = errors[0]
        assert err.severity == "blocker"
        assert err.fix_api["path"] == "/project/inspection/fix-column-ref"
        assert err.fix_api["body"]["old_column_id"] == "ghost_col"
        # context 应含该表可用列
        available_cols = err.context["available_columns"]
        assert "id" in available_cols and "email" in available_cols

    def test_unique_missing_column_checked(self):
        """Unique 约束的 column_ids 列表中的列缺失也要检测。"""
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        constraint_files = {
            "c1": make_constraint(type="Unique", refs={"table_id": "users", "column_ids": ["email", "ghost"]})
        }
        inspect_reference_integrity(schema_files, constraint_files, warnings, errors)
        # ghost 列不存在 → 应报错
        assert len(errors) == 1
        assert errors[0].fix_api["path"] == "/project/inspection/fix-column-ref"

    def test_foreign_key_src_table_missing(self):
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        constraint_files = {
            "c1": make_constraint(
                type="ForeignKey",
                refs={
                    "from_table_id": "ghost_src",
                    "from_column_id": "user_id",
                    "to_table_id": "users",
                    "to_column_id": "id",
                },
            )
        }
        inspect_reference_integrity(schema_files, constraint_files, warnings, errors)

        assert len(errors) == 1
        err = errors[0]
        assert err.fix_api["path"] == "/project/inspection/fix-table-ref"
        assert err.fix_api["body"]["field"] == "fk_src_table_missing"

    def test_foreign_key_dst_column_missing(self):
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        constraint_files = {
            "c1": make_constraint(
                type="ForeignKey",
                refs={
                    "from_table_id": "users",
                    "from_column_id": "email",
                    "to_table_id": "users",
                    "to_column_id": "ghost",
                },
            )
        }
        inspect_reference_integrity(schema_files, constraint_files, warnings, errors)

        assert len(errors) == 1
        assert errors[0].fix_api["body"]["field"] == "fk_dst_col_missing"

    def test_composite_outer_table_missing_detected(self):
        """Composite 外层 refs.table_id 缺失应报 blocker。"""
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        constraint_files = {
            "c1": make_constraint(type="Composite", refs={"table_id": "ghost"}, params={"logic": "AND"})
        }
        inspect_reference_integrity(schema_files, constraint_files, warnings, errors)

        assert len(errors) == 1
        assert errors[0].severity == "blocker"
        assert errors[0].fix_api["body"]["field"] == "composite_table_missing"

    def test_composite_sub_constraint_table_missing_detected(self):
        """Composite 子约束引用的表缺失应报 blocker。"""
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        constraint_files = {
            "c1": make_constraint(
                type="Composite",
                refs={"table_id": "users"},
                params={
                    "logic": "all",
                    "sub_constraints": [{"type": "NotNull", "refs": {"table_id": "ghost", "column_id": "id"}}],
                },
            )
        }
        inspect_reference_integrity(schema_files, constraint_files, warnings, errors)

        assert len(errors) == 1
        # 子约束表缺失，field 含子规则索引
        assert "composite_sub_table_missing" in errors[0].fix_api["body"]["field"]

    def test_composite_sub_constraint_column_missing_detected(self):
        """Composite 子约束引用的列缺失应报 blocker。"""
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        constraint_files = {
            "c1": make_constraint(
                type="Composite",
                refs={"table_id": "users"},
                params={
                    "logic": "all",
                    "sub_constraints": [{"type": "NotNull", "refs": {"table_id": "users", "column_id": "ghost_col"}}],
                },
            )
        }
        inspect_reference_integrity(schema_files, constraint_files, warnings, errors)

        assert len(errors) == 1
        assert "composite_sub_col_missing" in errors[0].fix_api["body"]["field"]
        assert errors[0].fix_api["body"]["old_column_id"] == "ghost_col"

    def test_composite_all_valid_no_error(self):
        """Composite 外层与子约束引用全部有效时不报错。"""
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        constraint_files = {
            "c1": make_constraint(
                type="Composite",
                refs={"table_id": "users"},
                params={
                    "logic": "all",
                    "sub_constraints": [
                        {"type": "NotNull", "refs": {"table_id": "users", "column_id": "email"}},
                        {"type": "Range", "refs": {"table_id": "users", "column_id": "id"}},
                    ],
                },
            )
        }
        inspect_reference_integrity(schema_files, constraint_files, warnings, errors)
        assert errors == []


# ============================================================================
# inspect_regex_reference_integrity 测试
# ============================================================================


class TestInspectRegexReferenceIntegrity:
    """正则节点 source_ref 引用完整性检查。"""

    def test_valid_regex_no_error(self):
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        regex_files = {"r1": make_regex()}
        inspect_regex_reference_integrity(regex_files, schema_files, warnings, errors)
        assert errors == []

    def test_regex_missing_table_generates_blocker(self):
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        regex_files = {"r1": make_regex(source_ref=RegexSourceRef(table_id="ghost", column_id="email"))}
        inspect_regex_reference_integrity(regex_files, schema_files, warnings, errors)

        assert len(errors) == 1
        err = errors[0]
        assert err.severity == "blocker"
        assert err.fix_api["path"] == "/project/inspection/fix-regex-table-ref"
        assert err.fix_api["body"]["regex_id"] == "r1"

    def test_regex_missing_column_generates_blocker(self):
        warnings: list[str] = []
        errors: list[LoadingError] = []
        schema_files = {"users": make_schema()}
        regex_files = {"r1": make_regex(source_ref=RegexSourceRef(table_id="users", column_id="ghost"))}
        inspect_regex_reference_integrity(regex_files, schema_files, warnings, errors)

        assert len(errors) == 1
        assert errors[0].fix_api["path"] == "/project/inspection/fix-regex-column-ref"

    def test_regex_without_source_ref_skipped(self):
        warnings: list[str] = []
        errors: list[LoadingError] = []
        regex_files = {"r1": make_regex(source_ref=None)}
        inspect_regex_reference_integrity(regex_files, {}, warnings, errors)
        assert errors == []


# ============================================================================
# inspect_config 主入口测试
# ============================================================================


class TestInspectConfigMain:
    """inspect_config 主入口编排行为。"""

    def test_clean_project_reports_nothing(self):
        warnings: list[str] = []
        errors: list[LoadingError] = []
        manifest = make_manifest()
        schema_files = {"users": make_schema()}
        inspect_config(Path("/tmp"), manifest, schema_files, {}, {}, {}, {}, warnings, errors)
        assert errors == []
        assert warnings == []

    def test_aggregates_all_check_results(self):
        """主入口应聚合 ID 不一致 + 引用缺失两类问题。"""
        warnings: list[str] = []
        errors: list[LoadingError] = []
        manifest = make_manifest(
            schemas=[SchemaRef(id="users_ref", path="schemas/users.schema.yaml")],
            constraints=[ConstraintRef(id="c1", path="constraints/c1.constraint.yaml")],
        )
        schema_files = {"users_ref": make_schema(id="users")}
        constraint_files = {"c1": make_constraint(refs={"table_id": "ghost", "column_id": "email"})}
        inspect_config(Path("/tmp"), manifest, schema_files, constraint_files, {}, {}, {}, warnings, errors)

        # 至少两条: 一条 ID 不一致 warning + 一条引用缺失 blocker
        severities = [e.severity for e in errors]
        assert "warning" in severities
        assert "blocker" in severities


# ============================================================================
# 自动修复端点测试（文件系统层面）
# ============================================================================


def _write_project(tmp_path: Path, files: dict[str, str]) -> str:
    """在 tmp_path 下写入一组相对路径→内容的文件，返回 config_path。"""
    for rel, content in files.items():
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    return str(tmp_path)


class TestFixTableRefEndpoint:
    """POST /inspection/fix-table-ref 行为测试。"""

    def test_fix_table_ref_updates_constraint_file(self, tmp_path):
        from app.api.routers.project.inspection_fix import FixTableRefRequest, fix_table_ref

        config_path = _write_project(
            tmp_path,
            {
                "constraints/c.constraint.yaml": (
                    "version: 2\nid: c1\ntype: NotNull\nrefs:\n  table_id: ghost\n  column_id: email\n"
                ),
            },
        )
        req = FixTableRefRequest(
            constraint_id="c1", field="ref_table_missing", old_table_id="ghost", new_table_id="users"
        )
        result = fix_table_ref(req, config_path)

        assert "ghost" in result["message"] and "users" in result["message"]
        raw = yaml.safe_load((tmp_path / "constraints" / "c.constraint.yaml").read_text(encoding="utf-8"))
        assert raw["refs"]["table_id"] == "users"

    def test_fix_table_ref_not_found_raises(self, tmp_path):
        from app.api.routers.project.inspection_fix import FixTableRefRequest, fix_table_ref

        config_path = _write_project(tmp_path, {})
        req = FixTableRefRequest(constraint_id="ghost", field="ref_table_missing", old_table_id="a", new_table_id="b")
        with pytest.raises(Exception):
            fix_table_ref(req, config_path)


class TestFixColumnRefEndpoint:
    """POST /inspection/fix-column-ref 行为测试。"""

    def test_fix_column_ref_updates_single_column(self, tmp_path):
        from app.api.routers.project.inspection_fix import FixColumnRefRequest, fix_column_ref

        config_path = _write_project(
            tmp_path,
            {
                "constraints/c.constraint.yaml": (
                    "version: 2\nid: c1\ntype: NotNull\nrefs:\n  table_id: users\n  column_id: old_col\n"
                ),
            },
        )
        req = FixColumnRefRequest(
            constraint_id="c1",
            field="ref_col_missing",
            table_id="users",
            old_column_id="old_col",
            new_column_id="email",
        )
        fix_column_ref(req, config_path)
        raw = yaml.safe_load((tmp_path / "constraints" / "c.constraint.yaml").read_text(encoding="utf-8"))
        assert raw["refs"]["column_id"] == "email"

    def test_fix_column_ref_updates_list_member(self, tmp_path):
        """Unique 的 column_ids 是列表，应替换其中的成员。"""
        from app.api.routers.project.inspection_fix import FixColumnRefRequest, fix_column_ref

        config_path = _write_project(
            tmp_path,
            {
                "constraints/c.constraint.yaml": (
                    "version: 2\nid: c1\ntype: Unique\nrefs:\n  table_id: users\n  column_ids: [old_col, email]\n"
                ),
            },
        )
        req = FixColumnRefRequest(
            constraint_id="c1", field="ref_col_missing", table_id="users", old_column_id="old_col", new_column_id="id"
        )
        fix_column_ref(req, config_path)
        raw = yaml.safe_load((tmp_path / "constraints" / "c.constraint.yaml").read_text(encoding="utf-8"))
        assert raw["refs"]["column_ids"] == ["id", "email"]


class TestFixRegexRefEndpoints:
    """正则引用修复端点测试。"""

    def test_fix_regex_table_ref(self, tmp_path):
        from app.api.routers.project.inspection_fix import FixRegexTableRefRequest, fix_regex_table_ref

        config_path = _write_project(
            tmp_path,
            {
                "regex/r.regex.yaml": (
                    "version: 2\nid: r1\nname: r\npattern: ^.+@.+$\nmatch_mode: full\n"
                    "source_ref:\n  table_id: ghost\n  column_id: email\n"
                ),
            },
        )
        req = FixRegexTableRefRequest(regex_id="r1", old_table_id="ghost", new_table_id="users")
        fix_regex_table_ref(req, config_path)
        raw = yaml.safe_load((tmp_path / "regex" / "r.regex.yaml").read_text(encoding="utf-8"))
        assert raw["source_ref"]["table_id"] == "users"

    def test_fix_regex_column_ref(self, tmp_path):
        from app.api.routers.project.inspection_fix import FixRegexColumnRefRequest, fix_regex_column_ref

        config_path = _write_project(
            tmp_path,
            {
                "regex/r.regex.yaml": (
                    "version: 2\nid: r1\nname: r\npattern: ^.+@.+$\nmatch_mode: full\n"
                    "source_ref:\n  table_id: users\n  column_id: old_col\n"
                ),
            },
        )
        req = FixRegexColumnRefRequest(regex_id="r1", table_id="users", old_column_id="old_col", new_column_id="email")
        fix_regex_column_ref(req, config_path)
        raw = yaml.safe_load((tmp_path / "regex" / "r.regex.yaml").read_text(encoding="utf-8"))
        assert raw["source_ref"]["column_id"] == "email"


class TestFixIdMismatchEndpoint:
    """POST /manifest/fix-id-mismatch 行为测试。"""

    def test_fix_id_mismatch_updates_manifest(self, tmp_path):
        from app.api.routers.project.inspection_fix import FixIdMismatchRequest, fix_id_mismatch

        config_path = _write_project(
            tmp_path,
            {
                "project.precis.yaml": (
                    "version: 2\nproject:\n  id: p\n  name: P\n"
                    "schemas:\n  - id: users_ref\n    path: schemas/users.schema.yaml\n"
                ),
            },
        )
        req = FixIdMismatchRequest(resource_type="schema", manifest_id="users_ref", file_id="users")
        fix_id_mismatch(req, config_path)
        raw = yaml.safe_load((tmp_path / "project.precis.yaml").read_text(encoding="utf-8"))
        assert raw["schemas"][0]["id"] == "users"

    def test_fix_id_mismatch_unknown_resource_type_raises(self, tmp_path):
        from app.api.routers.project.inspection_fix import FixIdMismatchRequest, fix_id_mismatch

        config_path = _write_project(tmp_path, {"project.precis.yaml": "version: 2\nproject:\n  id: p\n  name: P\n"})
        req = FixIdMismatchRequest(resource_type="unknown", manifest_id="a", file_id="b")
        with pytest.raises(Exception):
            fix_id_mismatch(req, config_path)
