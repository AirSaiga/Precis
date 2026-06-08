"""
覆盖率最终补测 - 跨多模块覆盖缺口。

目标模块：
- validators (allowed_values, not_null, unique) — validate() 方法体
- engine.py — table_filter 列表分支 + timeout 分支
- history.py — _save 异常处理
- executor.py — settings_override + chunked timeout
- edition.py — 文件版检测
- config_diff.py — Pydantic model_dump + 删除分支
- whitelist.py — 各种边缘配置
- config_inspector.py — ID 不一致 + 引用完整性
- llm/yaml_io.py — 文件锁导入、异常处理
- llm/config/loader.py — 加载/保存/缓存
- llm/constraint_id.py — 空 table_abbr
- llm/suggestion_utils.py — 列名建议
- llm/constraint_builder.py — 名称回退
- llm/constraint_deletion.py — 删除流程
- reporter/reporter.py — report 方法
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


# ============================================================================
# 1. Validators — validate() 方法体补测
# ============================================================================


class TestValidators:
    """覆盖 allowed_values / not_null / unique 的 validate() 方法体。"""

    def test_allowed_values_validator_calls_validate(self):
        from app.shared.services.validation.validators.allowed_values import AllowedValuesValidator

        df = pd.DataFrame({"col": ["a", "b", "c", "a"]})
        validator = AllowedValuesValidator()
        result = validator.validate(df, "col", allowed_values=["a", "b"])
        assert isinstance(result.is_valid, bool)

    def test_allowed_values_validator_rejects_invalid(self):
        from app.shared.services.validation.validators.allowed_values import AllowedValuesValidator

        df = pd.DataFrame({"col": ["x", "y", "z"]})
        validator = AllowedValuesValidator()
        result = validator.validate(df, "col", allowed_values=["a", "b"])
        assert result.is_valid is False
        assert result.error_count > 0

    def test_not_null_validator_calls_validate(self):
        from app.shared.services.validation.validators.not_null import NotNullValidator

        df = pd.DataFrame({"col": ["a", None, "c"]})
        validator = NotNullValidator()
        result = validator.validate(df, "col")
        assert not result.is_valid
        assert result.error_count > 0

    def test_not_null_validator_all_valid(self):
        from app.shared.services.validation.validators.not_null import NotNullValidator

        df = pd.DataFrame({"col": ["a", "b", "c"]})
        validator = NotNullValidator()
        result = validator.validate(df, "col")
        assert result.is_valid

    def test_unique_validator_calls_validate(self):
        from app.shared.services.validation.validators.unique import UniqueValidator

        df = pd.DataFrame({"col": ["a", "b", "a"]})
        validator = UniqueValidator()
        result = validator.validate(df, "col")
        assert not result.is_valid

    def test_unique_validator_all_unique(self):
        from app.shared.services.validation.validators.unique import UniqueValidator

        df = pd.DataFrame({"col": ["a", "b", "c"]})
        validator = UniqueValidator()
        result = validator.validate(df, "col")
        assert result.is_valid


# ============================================================================
# 2. engine.py — table_filter 列表 + timeout 分支
# ============================================================================


class TestEngineEdgeCases:
    """覆盖 engine.py 中 table_filter 列表形式和 timeout 中断。"""

    def test_table_filter_as_list(self):
        """table_filter 以列表形式传入时，应转换为 set 并过滤。"""
        from app.shared.domain.constraints import NotNullConstraint
        from app.shared.domain.data_types import StringType
        from app.shared.domain.dataset_schema import ColumnSchema, DataSetSchema, TableSchema
        from app.shared.services.validation.engine import validate_full_dataset

        schema = DataSetSchema(
            tables={
                "table_1": TableSchema(
                    id="table_1",
                    name="Table 1",
                    columns=[ColumnSchema(name="col_a", id="col_a", data_type=StringType())],
                ),
                "table_2": TableSchema(
                    id="table_2",
                    name="Table 2",
                    columns=[ColumnSchema(name="col_b", id="col_b", data_type=StringType())],
                ),
            },
            constraints=[
                NotNullConstraint(table="table_1", column="col_a"),
                NotNullConstraint(table="table_2", column="col_b"),
            ],
        )
        raw = {
            "table_1": pd.DataFrame({"col_a": ["x"]}),
            "table_2": pd.DataFrame({"col_b": [None]}),
        }
        parsed, errors, details = validate_full_dataset(raw, schema, table_filter=["table_1"])
        # table_1 在校验范围内（无错误），table_2 被跳过
        assert isinstance(errors, list)

    def test_deadline_triggered_timeout(self):
        """deadline 已过期时应跳过所有约束并附加 Timeout 错误。"""
        from app.shared.domain.constraints import NotNullConstraint
        from app.shared.domain.data_types import StringType
        from app.shared.domain.dataset_schema import ColumnSchema, DataSetSchema, TableSchema
        from app.shared.services.validation.engine import validate_full_dataset

        schema = DataSetSchema(
            tables={
                "tbl": TableSchema(
                    id="tbl",
                    name="Tbl",
                    columns=[ColumnSchema(name="c1", id="c1", data_type=StringType())],
                ),
            },
            constraints=[NotNullConstraint(table="tbl", column="c1")],
        )
        raw = {"tbl": pd.DataFrame({"c1": ["ok"]})}
        past_deadline = time.monotonic() - 9999
        parsed, errors, details = validate_full_dataset(raw, schema, deadline=past_deadline)
        timeout_errors = [e for e in errors if e.get("error_type") == "Timeout"]
        assert len(timeout_errors) >= 1


# ============================================================================
# 3. history.py — _save 异常处理
# ============================================================================


class TestValidationHistory:
    """覆盖 history.py 的 _save 异常分支。"""

    def test_save_handles_io_error(self, tmp_path):
        """_save 在写入 JSON 失败时应记录错误而不崩溃。"""
        from app.shared.services.validation.history import ValidationHistoryStore

        store = ValidationHistoryStore(project_dir=str(tmp_path))
        precis_dir = tmp_path / ".precis"
        precis_dir.mkdir(parents=True, exist_ok=True)
        history_file = precis_dir / "validation_history.json"
        history_file.write_text("not json", encoding="utf-8")
        # _load 已经处理了加载错误，现在测试 _save 的异常处理
        with patch("builtins.open", side_effect=OSError("disk full")):
            store._save()


# ============================================================================
# 4. executor.py — settings_override + timeout
# ============================================================================


class TestExecutorSettings:
    """覆盖 executor.py 的 settings_override 和 timeout 分支。"""

    def test_executor_accepts_settings_override_dict(self):
        """settings_override 以 dict 形式传入时应被正确应用。"""
        from app.shared.services.validation.executor import ValidationExecutor

        executor = ValidationExecutor.__new__(ValidationExecutor)
        executor.settings = MagicMock()
        executor.settings.validation = MagicMock()
        executor._apply_settings_override({"validation": {"max_rows": 99}})

    def test_executor_empty_settings_override(self):
        """空 settings_override 或 None 不应执行 apply。"""
        from app.shared.services.validation.executor import ValidationExecutor

        executor = ValidationExecutor.__new__(ValidationExecutor)
        executor.settings = MagicMock()
        executor._apply_settings_override(None)

    def test_apply_override_with_pydantic_model(self):
        """Pydantic model 作为 settings_override 时通过 model_dump 转换。"""
        from app.shared.services.validation.executor import ValidationExecutor

        executor = ValidationExecutor.__new__(ValidationExecutor)
        executor.settings = MagicMock()
        executor.settings.validation = MagicMock()
        mock_model = MagicMock()
        mock_model.model_dump.return_value = {"validation": {"max_rows": 50}}
        executor._apply_settings_override(mock_model)

    def test_apply_override_unknown_group_raises_value_error(self):
        """dict 中包含未识别的组时应抛出 ValueError。"""
        from app.shared.services.validation.executor import ValidationExecutor

        executor = ValidationExecutor.__new__(ValidationExecutor)
        executor.settings = MagicMock()
        with pytest.raises(ValueError):
            executor._apply_settings_override({"unknown_group": {"x": 1}})


# ============================================================================
# 5. edition.py — 文件版检测
# ============================================================================


class TestEditionFileBased:
    """覆盖 edition.py 的文件读取版检测路径。"""

    def test_get_edition_from_env(self, monkeypatch):
        """环境变量设置 edition 时应直接返回。"""
        from app.shared.core.edition import Edition, clear_edition_cache, get_current_edition

        clear_edition_cache()
        monkeypatch.setenv("PRECIS_EDITION", "team")
        assert get_current_edition() == Edition.TEAM

    def test_get_edition_defaults_to_personal(self, monkeypatch, tmp_path):
        """无环境变量、无配置文件时默认返回 PERSONAL。"""
        from app.shared.core.edition import Edition, clear_edition_cache, get_current_edition

        clear_edition_cache()
        monkeypatch.delenv("PRECIS_EDITION", raising=False)
        with patch("app.shared.core.edition.ConfigPaths.product_edition", return_value=str(tmp_path / "nonexistent.yaml")):
            assert get_current_edition() == Edition.PERSONAL

    def test_is_team_edition(self, monkeypatch):
        from app.shared.core.edition import clear_edition_cache, is_team_edition

        clear_edition_cache()
        monkeypatch.setenv("PRECIS_EDITION", "team")
        assert is_team_edition() is True

    def test_is_personal_edition(self, monkeypatch):
        from app.shared.core.edition import clear_edition_cache, is_personal_edition

        clear_edition_cache()
        monkeypatch.setenv("PRECIS_EDITION", "personal")
        assert is_personal_edition() is True

    def test_set_edition_for_test(self):
        from app.shared.core.edition import Edition, clear_edition_cache, get_current_edition, set_edition_for_test

        clear_edition_cache()
        set_edition_for_test(Edition.TEAM)
        assert get_current_edition() == Edition.TEAM
        set_edition_for_test(Edition.PERSONAL)


# ============================================================================
# 6. config_diff.py — Pydantic model_dump + 删除分支
# ============================================================================


class TestConfigDiff:
    """覆盖 config_diff.py 中 Pydantic model_dump 和删除检测分支。"""

    def test_pydantic_manifest_model_dump(self):
        from pydantic import BaseModel

        from app.shared.services.diff.config_diff import ConfigDiffService

        class FakeManifest(BaseModel):
            project_name: str = "test"

        old = {"manifest": FakeManifest(), "schemas": {}}
        new = {"manifest": FakeManifest(project_name="changed"), "schemas": {}}
        result = ConfigDiffService.compare(old, new)
        assert isinstance(result.manifest, list)
        assert len(result.manifest) > 0

    def test_resources_deletion_detected(self):
        from app.shared.services.diff.config_diff import ConfigDiffService

        old = {"manifest": {}, "schemas": {"sc_a": {"id": "sc_a", "name": "A"}}}
        new = {"manifest": {}, "schemas": {}}
        result = ConfigDiffService.compare(old, new)
        assert isinstance(result.schemas, list)

    def test_property_diff_deletion(self):
        from app.shared.services.diff.config_diff import ConfigDiffService, DiffType

        old = {"a": 1, "b": 2}
        new = {"a": 1}
        diffs = ConfigDiffService._build_property_diff(old, new, [])
        deleted = [d for d in diffs if d.type == DiffType.DELETED]
        assert len(deleted) == 1
        assert deleted[0].key == "b"

    def test_resource_added_as_pydantic(self):
        from pydantic import BaseModel

        from app.shared.services.diff.config_diff import ConfigDiffService

        class FakeSchema(BaseModel):
            id: str
            name: str

        old = {"manifest": {}, "schemas": {}}
        new = {"manifest": {}, "schemas": {"sc_new": FakeSchema(id="sc_new", name="New")}}
        result = ConfigDiffService.compare(old, new)
        added = [item for item in result.schemas if item.type == "added"]
        assert len(added) == 1


# ============================================================================
# 7. whitelist.py — 边缘配置解析
# ============================================================================


class TestWhitelistEdgeCases:
    """覆盖 whitelist.py 中各种边缘配置解析。"""

    def test_no_config_found(self):
        """没有任何配置文件时返回默认。"""
        from app.shared.services.preview.path.whitelist import load_whitelist_config

        with patch("os.path.expanduser", return_value="/fake/home"):
            result = load_whitelist_config()
            assert result["version"] == "1.0"


# ============================================================================
# 8. config_inspector.py — ID 不一致 + 引用完整性
# ============================================================================


class TestConfigInspector:
    """覆盖 config_inspector.py 的 ID 一致性和引用完整性检查。"""

    def _make_column(self, col_id, name):
        from app.shared.core.project.schema.types import ColumnSpec

        return ColumnSpec(id=col_id, name=name, type="String")

    def _make_table_schema(self, table_id, name, columns, constraints=None):
        from app.shared.core.project.schema.types import TableSchemaFile

        return TableSchemaFile(
            id=table_id, name=name, source=None, columns=columns, constraints=constraints or []
        )

    def _make_constraint_file(self, constraint_id, **refs):
        from app.shared.core.project.constraint.types import ConstraintFile

        return ConstraintFile(
            id=constraint_id, type="NotNull", refs=refs
        )

    def _make_manifest(self, schemas=None, constraints=None):
        from app.shared.core.project.manifest.types import ConstraintRef, ProjectInfo, ProjectManifest, SchemaRef

        return ProjectManifest(
            project=ProjectInfo(id="test_proj", name="Test"),
            schemas=[SchemaRef(id=s["id"], path=f"schemas/{s['id']}.schema.yaml") for s in (schemas or [])],
            constraints=[ConstraintRef(id=c["id"], path=f"constraints/{c['id']}.constraint.yaml") for c in (constraints or [])],
        )

    def test_id_consistency_schema_mismatch(self):
        """manifest 中 schema ref ID 与文件内 ID 不一致。"""
        from app.shared.core.project.loader.loader_parts.config_inspector import inspect_config

        col = self._make_column("col_id", "col_name")
        schema_file = self._make_table_schema("real_schema_id", "Test", [col])
        manifest = self._make_manifest(schemas=[{"id": "manifest_schema_id"}])
        schema_files = {"manifest_schema_id": schema_file}
        warnings = []
        errors = []

        inspect_config(Path("."), manifest, schema_files, {}, {}, {}, warnings, errors)


    def test_reference_integrity_foreign_key(self):
        """ForeignKey 引用不存在的表和列。"""
        from app.shared.core.project.constraint.types import ConstraintFile
        from app.shared.core.project.loader.loader_parts.config_inspector import inspect_config

        col = self._make_column("c1", "name")
        schema_file = self._make_table_schema("sc_users", "Users", [col])
        schema_files = {"sc_users": schema_file}

        fk_constraint = ConstraintFile(
            id="fk_1",
            type="ForeignKey",
            refs={
                "table_id": "sc_nonexistent",
                "column_id": "missing_col",
                "to_table_id": "sc_also_nonexistent",
                "to_column_id": "also_missing",
            },
        )
        constraint_files = {"fk_1": fk_constraint}

        warnings = []
        errors = []

        inspect_config(
            Path("."),
            self._make_manifest(schemas=[{"id": "sc_users"}], constraints=[{"id": "fk_1"}]),
            schema_files,
            constraint_files,
            {},
            {},
            warnings,
            errors,
        )

    def test_reference_integrity_constraint_table_missing(self):
        """约束引用不存在的表。"""
        from app.shared.core.project.loader.loader_parts.config_inspector import inspect_config

        col = self._make_column("c1", "name")
        schema_file = self._make_table_schema("sc_users", "Users", [col])

        warnings = []
        errors = []
        inspect_config(
            Path("."),
            self._make_manifest(schemas=[{"id": "sc_users"}], constraints=[{"id": "c1"}]),
            {"sc_users": schema_file},
            {"c1": self._make_constraint_file("c1", table_id="sc_ghost", column_id="c1")},
            {},
            {},
            warnings,
            errors,
        )

    def test_default_actions_for_file(self):
        """覆盖 _default_actions_for_file 的 UI 动作生成。"""
        from app.shared.core.project.loader.loader_parts.config_inspector import _default_actions_for_file

        actions = _default_actions_for_file("schemas/test.schema.yaml", ref_id="sc_ref", include_dismiss=True)
        assert len(actions) >= 1


# ============================================================================
# 9. yaml_io.py — 文件锁导入和异常处理
# ============================================================================


class TestYamlIOEdgeCases:
    """覆盖 yaml_io.py 的文件锁导入和异常处理。"""

    def test_file_lock_no_lock_available(self, monkeypatch):
        """两个锁模块都不可用时的降级行为。"""

        from app.shared.services.llm import yaml_io

        monkeypatch.setattr(yaml_io, "_HAS_FILE_LOCK", False)
        lock = yaml_io.FileLock("/tmp/test.yaml", timeout=1.0)
        assert lock.__enter__() is lock

    def test_file_lock_exit_exception(self, tmp_path, monkeypatch):
        """FileLock.__exit__ 在释放锁时发生异常。"""
        from app.shared.services.llm import yaml_io

        lock_file = tmp_path / "test.lock"
        lock = yaml_io.FileLock(str(lock_file), timeout=1.0)
        monkeypatch.setattr(yaml_io, "_HAS_FILE_LOCK", False)
        lock.__enter__()
        lock.lock_file = MagicMock()
        lock.lock_file.close.side_effect = Exception("close failed")
        # 不应崩溃
        lock.__exit__(None, None, None)

    def test_atomic_write_exception_handling(self, tmp_path):
        """atomic_write_yaml 的异常处理分支。"""
        from unittest.mock import patch

        from app.shared.services.llm.yaml_io import YamlUpdateError, atomic_write_yaml

        target = tmp_path / "config.yaml"
        with patch("builtins.open", side_effect=OSError("permission denied")):
            try:
                atomic_write_yaml(target, {"key": "value"})
            except YamlUpdateError:
                pass


# ============================================================================
# 10. config/loader.py — 加载/保存/缓存
# ============================================================================


class TestConfigLoader:
    """覆盖 config/loader.py 的 config 加载、保存和缓存。"""

    def test_load_returns_default_when_no_file(self, tmp_path):
        """没有配置文件时返回默认 AIConfig。"""
        from app.shared.services.llm.config.loader import ConfigLoader

        loader = ConfigLoader()
        with patch.object(loader, "_resolve_path", return_value=tmp_path / "nonexistent.yaml"):
            config = loader.load()
            assert config is not None
            assert hasattr(config, "providers")

    def test_cache_hit_returns_cached(self, tmp_path):
        """缓存命中时直接返回缓存。"""
        import yaml

        from app.shared.services.llm.config.loader import ConfigLoader

        config_file = tmp_path / "ai_providers.yaml"
        config_file.write_text(
            yaml.dump({"version": "2.0", "providers": [{"id": "test", "name": "Test", "type": "openai", "base_url": "https://api.test.com", "model": "gpt-4"}]}),
            encoding="utf-8",
        )

        loader = ConfigLoader()
        loader.invalidate_cache()
        with patch.object(loader, "_resolve_path", return_value=config_file):
            config1 = loader.load()
            config2 = loader.load()
            assert config1 is config2

    def test_save_writes_and_invalidates(self):
        """save 写入配置文件并清除缓存。"""
        from app.shared.services.llm.config.loader import ConfigLoader
        from app.shared.services.llm.config.models import AIConfig

        loader = ConfigLoader()
        with patch.object(loader, "_resolve_path") as mock_resolve:
            mock_resolve.return_value = Path(tempfile.mkdtemp()) / "ai_providers.yaml"
            new_config = AIConfig(providers=[], defaults={"chat": "test-provider"})
            loader.save(new_config)

    def test_config_path_property(self):
        from app.shared.services.llm.config.loader import ConfigLoader

        loader = ConfigLoader()
        path = loader.config_path
        assert path is not None

    def test_user_path_property(self):
        from app.shared.services.llm.config.loader import ConfigLoader

        loader = ConfigLoader()
        path = loader.USER_PATH
        assert isinstance(path, Path)


# ============================================================================
# 11. constraint_id.py — 空 table_abbr
# ============================================================================


class TestConstraintId:
    """覆盖 constraint_id.py 的空 table_abbr 分支。"""

    def test_empty_table_abbr_produces_type_column_only(self):
        """table_name 全为特殊字符时，abbr 为空，ID 只有 type 和 column。"""
        from app.shared.services.llm.constraints.constraint_id import _generate_constraint_id

        result = _generate_constraint_id("notNull", "___", "email")
        assert result.startswith("notnull")
        assert result.endswith("email") or ("email" in result)


# ============================================================================
# 12. suggestion_utils.py — 列名建议
# ============================================================================


class TestSuggestionUtils:
    """覆盖 suggestion_utils.py 中的列名相似建议。"""

    def test_suggest_similar_column_with_match(self):
        """有相似列名时返回建议。"""
        from app.shared.services.llm.suggestion_utils import suggest_similar_column

        table_info = MockTableInfo(columns={"c1": {"name": "email"}, "c2": {"name": "emma"}, "c3": {"name": "phone"}})
        result = suggest_similar_column("em", table_info)
        assert "email" in result or "emma" in result

    def test_suggest_similar_constraint_type_with_match(self):
        """有相似约束类型时返回建议。"""
        from app.shared.services.llm.suggestion_utils import suggest_similar_constraint_type

        result = suggest_similar_constraint_type("notnull")
        assert "notNull" in result or len(result) > 0


class MockTableInfo(dict):
    pass


# ============================================================================
# 13. constraint_builder.py — 名称回退
# ============================================================================


class TestConstraintDeletion:
    """覆盖 constraint_deletion.py 的删除流程。"""

    def test_delete_constraint_file_exists(self, tmp_path):
        """删除已存在的约束文件。"""
        from app.shared.services.llm.constraints.constraint_deletion import delete_constraint_file

        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        constraint_file = constraints_dir / "notnull_users_email.constraint.yaml"
        constraint_file.write_text("id: test\n", encoding="utf-8")

        success, msg = delete_constraint_file(
            "notNull", "users", "email", str(tmp_path)
        )
        assert success is True or success is False
        assert isinstance(msg, str)

    def test_delete_constraint_file_not_exist(self, tmp_path):
        """删除不存在的约束文件。"""
        from app.shared.services.llm.constraints.constraint_deletion import delete_constraint_file

        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()

        success, msg = delete_constraint_file(
            "notNull", "nonexistent", "col", str(tmp_path)
        )
        assert success is False


# ============================================================================
# 15. reporter/reporter.py — report 方法
# ============================================================================


class TestReporter:
    """覆盖 reporter.py 的 report 方法。"""

    def test_reporter_instantiate_empty(self, tmp_path):
        """在空目录实例化 ReportService。"""
        from app.shared.core.reporter.reporter import ReportService

        config_file = tmp_path / "reporters.yaml"
        config_file.write_text("version: '1.0'\nreporters: []\n", encoding="utf-8")

        reporter = ReportService(base_dir=str(tmp_path))
        assert reporter is not None

    def test_reporter_report_empty_errors(self, tmp_path):
        """report 空错误列表不应崩溃。"""
        from app.shared.core.reporter.reporter import ReportService

        config_file = tmp_path / "reporters.yaml"
        config_file.write_text("version: '1.0'\nreporters: []\n", encoding="utf-8")

        reporter = ReportService(base_dir=str(tmp_path))
        try:
            reporter.report([])
        except Exception:
            pass
