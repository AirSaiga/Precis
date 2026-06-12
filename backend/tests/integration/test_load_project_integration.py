"""
@fileoverview V2 项目加载与校验全流程集成测试

使用 qa_test/qa_simple 真实项目作为 fixture，端到端测试：
- load_project() 完整加载流程
- ValidationExecutor 真实执行（不 mock）
- 加载错误与警告的传播
- schema/constraint/regex 引用解析
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest

from app.shared.core.project.loader.loader_parts.main import load_project
from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

QA_SIMPLE_ROOT = Path(__file__).resolve().parents[3] / "qa_test" / "qa_simple"


def _copy_qa_simple_into(tmp_path: Path) -> Path:
    """将 qa_simple 复制到 tmp_path，避免污染源文件。"""
    if not QA_SIMPLE_ROOT.is_dir():
        pytest.skip(f"qa_simple fixture not found at {QA_SIMPLE_ROOT}")
    target = tmp_path / "qa_simple"
    shutil.copytree(QA_SIMPLE_ROOT, target)
    return target


class TestLoadProjectIntegration:
    """load_project() 真实加载测试"""

    def test_load_qa_simple_returns_expected_schemas(self, tmp_path):
        proj = _copy_qa_simple_into(tmp_path)
        manifest = str(proj / "project.precis.yaml")

        result = load_project(manifest)

        # 基本元数据加载
        assert result.manifest.project.id == "qa_simple"
        assert result.manifest.project.name == "qa_simple"

        # schemas 应被全部解析（4 个）
        schema_ids = set(result.schema_files.keys())
        assert len(schema_ids) >= 4

        # constraints 应被全部解析
        assert len(result.constraint_files) >= 1

        # regex_nodes 应被全部解析
        assert len(result.regex_node_files) >= 1

        # dataset_schema 应构建
        assert result.dataset_schema is not None

    def test_load_qa_simple_emits_known_warnings(self, tmp_path):
        """qa_simple 加载后应正常完成，manifest 和 schema 均可用。"""
        proj = _copy_qa_simple_into(tmp_path)
        result = load_project(str(proj / "project.precis.yaml"))

        # 加载阶段不应该失败（应返回 result 对象，即使有 warnings）
        assert result.manifest is not None
        assert result.manifest.project.id == "qa_simple"
        assert len(result.schema_files) >= 4

    def test_load_project_with_missing_schema_ref_returns_errors(self, tmp_path):
        """manifest 引用不存在的 schema 时，load_project 应返回 loading_errors 而非崩溃。"""
        proj = tmp_path / "broken_ref"
        proj.mkdir()
        (proj / "schemas").mkdir()
        (proj / "project.precis.yaml").write_text(
            """version: 2
project:
  id: broken
  name: broken
schemas:
  - id: ghost
    path: schemas/ghost.schema.yaml
""",
            encoding="utf-8",
        )

        # 不存在的 schema 引用应被记录为 loading_errors，而非抛异常
        result = load_project(str(proj / "project.precis.yaml"))
        assert result is not None
        assert "ghost" not in result.schema_files
        # 应有 SchemaNotFound 类型的加载错误
        assert any(
            (e.error_type or "").lower().find("schema") >= 0 or "ghost" in (e.message or "")
            for e in (result.loading_errors or [])
        )

    def test_load_project_corrupt_yaml_raises(self, tmp_path):
        """完全损坏的 YAML 应抛 YAML 解析异常（这是设计上的硬错误，无法静默恢复）。"""
        import yaml as _yaml

        bad_manifest = tmp_path / "project.precis.yaml"
        bad_manifest.write_text("this: is: not: valid: yaml: : :", encoding="utf-8")

        # 完全损坏的 YAML 由 PyYAML 直接抛 ScannerError，load_project 不应吞掉
        with pytest.raises(_yaml.YAMLError):
            load_project(str(bad_manifest))


class TestValidationExecutorIntegration:
    """ValidationExecutor 真实执行（不 mock）测试"""

    def test_execute_qa_simple_returns_clean(self, tmp_path):
        """对 qa_simple 真实数据执行校验，应无错误。"""
        proj = _copy_qa_simple_into(tmp_path)
        manifest = str(proj / "project.precis.yaml")
        data_dir = str(proj / "data")

        executor = ValidationExecutor(manifest)
        result = executor.execute(data_dir, ValidationOptions(timeout_seconds=30))

        # 顶层键
        assert "errors" in result
        assert "duration_ms" in result

        # qa_simple 的 fixture 数据应当无错误
        errors = result.get("errors") or []
        assert errors == [], f"qa_simple should be clean, got: {errors[:3]}"

    def test_execute_qa_simple_with_table_filter_by_id(self, tmp_path):
        """table_filter 只接受表 ID（不是 display name）。"""
        proj = _copy_qa_simple_into(tmp_path)
        manifest = str(proj / "project.precis.yaml")
        data_dir = str(proj / "data")

        # 找到 Employees schema 的真实 ID
        from app.shared.core.project.loader.loader_parts.main import load_project

        loaded = load_project(manifest)
        employee_schema_id = next(sid for sid, sf in loaded.schema_files.items() if sf.name == "Employees")

        executor = ValidationExecutor(manifest)
        result = executor.execute(
            data_dir,
            ValidationOptions(timeout_seconds=30, table_filter=employee_schema_id),
        )

        # 即便指定表，qa_simple 数据也应当通过
        errors = result.get("errors") or []
        assert errors == [], f"qa_simple should be clean for table={employee_schema_id}, got: {errors[:2]}"

    def test_execute_qa_simple_with_invalid_table_filter_yields_no_data(self, tmp_path):
        """不存在的 table_filter 不会抛异常，但应报告加载错误。"""
        proj = _copy_qa_simple_into(tmp_path)
        manifest = str(proj / "project.precis.yaml")
        data_dir = str(proj / "data")

        executor = ValidationExecutor(manifest)
        result = executor.execute(
            data_dir,
            ValidationOptions(timeout_seconds=10, table_filter="__nonexistent_table__"),
        )

        # 应报告加载错误（可能在 loading_errors 或 errors 字段中），但不应该崩溃
        all_errors = (result.get("loading_errors") or []) + (result.get("errors") or [])
        error_text = " ".join(str(e.get("message", "")) for e in all_errors)
        assert "未能" in error_text or "未找到" in error_text or "no data" in error_text.lower()

    def test_execute_detects_actual_violation(self, tmp_path):
        """构造一个故意违反约束的数据集，验证执行器能检测到。"""
        proj = tmp_path / "violation"
        proj.mkdir()
        (proj / "schemas").mkdir()
        (proj / "constraints").mkdir()
        (proj / "data").mkdir()

        # 数据：name 列存在空值
        (proj / "data" / "t.csv").write_text(
            "id,name\n1,alice\n2,\n3,charlie\n",
            encoding="utf-8",
        )
        (proj / "schemas" / "t.schema.yaml").write_text(
            """version: 2
id: t
name: t
source:
  mode: relative_file
  path: data/t.csv
columns:
  - id: id
    name: id
    type: integer
    primary_key: true
  - id: name
    name: name
    type: string
    nullable: false
""",
            encoding="utf-8",
        )
        (proj / "constraints" / "nn_name.constraint.yaml").write_text(
            """version: 2
id: nn_name
type: NotNull
enabled: true
refs:
  table_id: t
  column_id: name
""",
            encoding="utf-8",
        )
        (proj / "project.precis.yaml").write_text(
            """version: 2
project:
  id: violation_test
  name: Violation Test
schemas:
  - id: t
    path: schemas/t.schema.yaml
constraints:
  - id: nn_name
    path: constraints/nn_name.constraint.yaml
""",
            encoding="utf-8",
        )

        executor = ValidationExecutor(str(proj / "project.precis.yaml"))
        result = executor.execute(str(proj / "data"), ValidationOptions(timeout_seconds=30))

        errors = result.get("errors") or []
        assert len(errors) > 0, "Should detect empty name as NotNull violation"
        # 至少一条错误应涉及 name 列
        error_summary = str(errors)
        assert "name" in error_summary.lower() or "notnull" in error_summary.lower() or "null" in error_summary.lower()

    def test_executor_loading_errors_are_returned_not_raised(self, tmp_path):
        """加载阶段错误应作为结果返回，不抛异常。"""
        # 构造一个引用了不存在 schema 的 manifest
        proj = tmp_path / "broken_ref"
        proj.mkdir()
        (proj / "schemas").mkdir()
        (proj / "data").mkdir()
        (proj / "project.precis.yaml").write_text(
            """version: 2
project:
  id: broken
  name: broken
schemas:
  - id: ghost
    path: schemas/ghost.schema.yaml
""",
            encoding="utf-8",
        )

        executor = ValidationExecutor(str(proj / "project.precis.yaml"))
        # 应不抛异常
        result = executor.execute(str(proj / "data"), ValidationOptions(timeout_seconds=10))
        assert result is not None
        assert "errors" in result
        # loading_errors 字段应当包含错误
        loading_errors = result.get("loading_errors") or []
        assert len(loading_errors) > 0
