"""
@fileoverview load_project 端到端单元测试

在临时目录中构建完整项目结构并测试加载流程。
"""

import pytest

from app.shared.core.project.loader.loader_parts.main import load_project
from app.shared.services.project_loader import build_dataset_schema


class TestLoadProject:
    def test_full_project(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users
    path: schemas/users.schema.yaml
constraints:
  - id: notnull_name
    path: constraints/notnull_name.constraint.yaml
""",
            encoding="utf-8",
        )

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            """
version: 2
id: users
name: users
source:
  mode: relative_file
  path: data/users.xlsx
  sheet: Sheet1
columns:
  - id: user_id
    name: user_id
    type: string
    primary_key: true
  - id: name
    name: name
    type: string
    nullable: false
""",
            encoding="utf-8",
        )

        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        (constraints_dir / "notnull_name.constraint.yaml").write_text(
            """
version: 2
id: notnull_name
type: NotNull
enabled: true
refs:
  table_id: users
  column_id: name
""",
            encoding="utf-8",
        )

        # 注入 schema_builder 以构建 dataset_schema（core 层不再自行依赖 services）
        result = load_project(str(manifest), schema_builder=build_dataset_schema)
        assert result.manifest.project.id == "test-project"
        assert "users" in result.schema_files
        assert result.schema_files["users"].name == "users"
        assert "notnull_name" in result.constraint_files
        assert result.dataset_schema is not None
        assert len(result.loading_errors) == 0

    def test_top_level_sheet_fallback_without_source(self, tmp_path):
        """无 source 但有顶层 sheet 字段时，dataset_schema 应回退使用顶层 sheet 名。

        覆盖 schema_runtime_builder 的向后兼容逻辑（旧 runtime.py 曾处理此场景）。
        source.sheet 与顶层 sheet 互斥，但单独的顶层 sheet 是合法配置。
        """
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: orders
    path: schemas/orders.schema.yaml
""",
            encoding="utf-8",
        )

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        # 关键：无 source，只有顶层 sheet 字段
        (schemas_dir / "orders.schema.yaml").write_text(
            """
version: 2
id: orders
name: orders
sheet: SheetOrders
columns:
  - id: order_id
    name: order_id
    type: string
    primary_key: true
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest), schema_builder=build_dataset_schema)
        table = result.dataset_schema.tables["orders"]
        # 顶层 sheet 应被回退读取为 sheet_name
        assert table.sheet_name == "SheetOrders"
        # 无 source 时 source_file 应为 None
        assert table.source_file is None

    def test_missing_schema(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users
    path: schemas/missing.schema.yaml
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        assert "users" not in result.schema_files
        assert any(e.error_type == "SchemaNotFound" for e in result.loading_errors)
        assert len(result.warnings) > 0

    def test_invalid_schema(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users
    path: schemas/bad.schema.yaml
""",
            encoding="utf-8",
        )

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "bad.schema.yaml").write_text("not: valid: yaml: [", encoding="utf-8")

        result = load_project(str(manifest))
        assert "users" not in result.schema_files
        assert any(e.error_type == "SchemaParseError" for e in result.loading_errors)

    def test_unsupported_version(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 99
project:
  id: test-project
  name: Test Project
""",
            encoding="utf-8",
        )

        with pytest.raises(ValueError) as exc_info:
            load_project(str(manifest))
        assert "不支持" in str(exc_info.value)

    def test_missing_constraint(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
constraints:
  - id: missing
    path: constraints/missing.constraint.yaml
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        assert "missing" not in result.constraint_files
        assert any(e.error_type == "ConstraintNotFound" for e in result.loading_errors)

    def test_invalid_constraint(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
constraints:
  - id: bad
    path: constraints/bad.constraint.yaml
""",
            encoding="utf-8",
        )

        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        (constraints_dir / "bad.constraint.yaml").write_text("not: valid: yaml: [", encoding="utf-8")

        result = load_project(str(manifest))
        assert "bad" not in result.constraint_files
        assert any(e.error_type == "ConstraintParseError" for e in result.loading_errors)

    def test_missing_regex(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
regex_nodes:
  - id: missing
    path: regex/missing.regex.yaml
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        assert "missing" not in result.regex_node_files
        assert any(e.error_type == "RegexNotFound" for e in result.loading_errors)

    def test_invalid_regex(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
regex_nodes:
  - id: bad
    path: regex/bad.regex.yaml
""",
            encoding="utf-8",
        )

        regex_dir = tmp_path / "regex"
        regex_dir.mkdir()
        (regex_dir / "bad.regex.yaml").write_text("not: valid: yaml: [", encoding="utf-8")

        result = load_project(str(manifest))
        assert "bad" not in result.regex_node_files
        assert any(e.error_type == "RegexParseError" for e in result.loading_errors)

    def test_id_mismatch_warning(self, tmp_path):
        """测试 manifest ID 与文件内部 ID 不一致时产生警告。"""
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users_old
    path: schemas/users.schema.yaml
""",
            encoding="utf-8",
        )

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            """
version: 2
id: users
name: users
columns:
  - id: user_id
    name: user_id
    type: string
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        assert any("ID 不一致" in w for w in result.warnings)
        assert any(e.error_type == "IdMismatchWarning" for e in result.loading_errors)

    def test_reference_integrity_error(self, tmp_path):
        """测试约束引用不存在的表时产生错误。"""
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users
    path: schemas/users.schema.yaml
constraints:
  - id: bad_ref
    path: constraints/bad_ref.constraint.yaml
""",
            encoding="utf-8",
        )

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            """
version: 2
id: users
name: users
columns:
  - id: user_id
    name: user_id
    type: string
""",
            encoding="utf-8",
        )

        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        (constraints_dir / "bad_ref.constraint.yaml").write_text(
            """
version: 2
id: bad_ref
type: NotNull
enabled: true
refs:
  table_id: nonexistent_table
  column_id: user_id
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        assert any(e.error_type == "ReferenceIntegrityError" for e in result.loading_errors)
        assert any("不存在" in e.message for e in result.loading_errors if e.error_type == "ReferenceIntegrityError")

    def test_reference_integrity_column_error(self, tmp_path):
        """测试约束引用不存在的列时产生错误。"""
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users
    path: schemas/users.schema.yaml
constraints:
  - id: bad_col_ref
    path: constraints/bad_col_ref.constraint.yaml
""",
            encoding="utf-8",
        )

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            """
version: 2
id: users
name: users
columns:
  - id: user_id
    name: user_id
    type: string
""",
            encoding="utf-8",
        )

        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        (constraints_dir / "bad_col_ref.constraint.yaml").write_text(
            """
version: 2
id: bad_col_ref
type: NotNull
enabled: true
refs:
  table_id: users
  column_id: nonexistent_column
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        assert any(e.error_type == "ReferenceIntegrityError" for e in result.loading_errors)
        assert any(
            "列" in e.message and "不存在" in e.message
            for e in result.loading_errors
            if e.error_type == "ReferenceIntegrityError"
        )

    def test_naming_convention_no_warning(self, tmp_path):
        """测试文件名与内部 ID 不一致时不应再产生警告（规则已删除）。

        背景：之前存在「filename == id」的命名检查，但 id 是系统 hash、
        filename 是用户可读名，二者是不同维度，不应强制相等。
        本测试确保该规则已彻底删除。
        """
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users_v2
    path: schemas/users_old_name.schema.yaml
""",
            encoding="utf-8",
        )

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users_old_name.schema.yaml").write_text(
            """
version: 2
id: users_v2
name: users v2
columns:
  - id: user_id
    name: user_id
    type: string
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        # 不应再产生 NamingConventionWarning
        assert not any(e.error_type == "NamingConventionWarning" for e in result.loading_errors)
        assert not any("命名不规范" in w for w in result.warnings)

    def test_reference_integrity_nested_column(self, tmp_path):
        """测试嵌套列引用能正确解析（递归遍历 children）。

        背景：之前 inspect_reference_integrity 只看 schema_file.columns 顶层，
        对 JSON schema 的嵌套子列（如 supplier.children.supplier_rating）
        会误报为「列不存在」。本测试验证递归已生效。
        """
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: products
    path: schemas/products.schema.yaml
constraints:
  - id: range_rating
    path: constraints/range_rating.constraint.yaml
""",
            encoding="utf-8",
        )

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        # JSON 风格的嵌套 schema：supplier 包含 supplier_rating 子列
        (schemas_dir / "products.schema.yaml").write_text(
            """
version: 2
id: products
name: products
columns:
  - id: product_id
    name: product_id
    type: string
  - id: supplier
    name: supplier
    type: JsonObject
    expand: true
    children:
      - id: supplier_rating
        name: rating
        type: float
""",
            encoding="utf-8",
        )

        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        # 约束引用嵌套子列 supplier_rating
        (constraints_dir / "range_rating.constraint.yaml").write_text(
            """
version: 2
id: range_rating
type: Range
enabled: true
refs:
  table_id: products
  column_id: supplier_rating
params:
  min: 0
  max: 5
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        # 不应误报为「列不存在」
        ref_errors = [e for e in result.loading_errors if e.error_type == "ReferenceIntegrityError"]
        assert not any("supplier_rating" in e.message and "不存在" in e.message for e in ref_errors)

    def test_inspection_no_false_positives(self, tmp_path):
        """测试配置正确时不产生误报。"""
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users
    path: schemas/users.schema.yaml
constraints:
  - id: notnull_name
    path: constraints/notnull_name.constraint.yaml
""",
            encoding="utf-8",
        )

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            """
version: 2
id: users
name: users
columns:
  - id: user_id
    name: user_id
    type: string
  - id: name
    name: name
    type: string
""",
            encoding="utf-8",
        )

        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        (constraints_dir / "notnull_name.constraint.yaml").write_text(
            """
version: 2
id: notnull_name
type: NotNull
enabled: true
refs:
  table_id: users
  column_id: name
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        # 不应有自检相关的错误
        assert not any(e.error_type == "IdMismatchWarning" for e in result.loading_errors)
        assert not any(e.error_type == "ReferenceIntegrityError" for e in result.loading_errors)
        assert not any(e.error_type == "NamingConventionWarning" for e in result.loading_errors)
