"""
@fileoverview API 模型单元测试

测试 app/api/models 中的 Pydantic 模型。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.api.models.full_validation import (
    CoverageGroup,
    CoverageRef,
    FileProcessingSettingsOverride,
    FullValidationErrorItem,
    FullValidationOptions,
    FullValidationRequest,
    FullValidationResponse,
    FullValidationSummary,
    ProjectSettingsOverride,
    ScriptSecuritySettingsOverride,
    ValidationCoverage,
    ValidationPassedItem,
    ValidationSettingsOverride,
    ValidationStatistics,
    ValidationTaskRunOptions,
    ValidationTaskTarget,
)
from app.api.models.preview import FilePreviewResponse
from app.api.models.project import PathsModel, ProjectConfigModel, ProjectDetail, StandardResponse
from app.api.models.schema import (
    HeaderRowChangedRequest,
    HeaderRowChangedResponse,
    SchemaSaveRequest,
    SchemaSaveResponse,
)
from app.api.models.validation import (
    RegexValidationRequest,
    RegexValidationResponse,
    RegexValidationResult,
    ValidationRequest,
    ValidationResponse,
    ValidationResult,
    ValidationType,
)
from app.api.models.workspace import ExternalDataSource, UIPreferences, WorkspaceConfig


class TestPreviewModels:
    def test_file_preview_response_defaults(self):
        r = FilePreviewResponse(success=True, file_type="csv", file_name="test.csv")
        assert r.success is True
        assert r.data is None
        assert r.total_rows is None


class TestProjectModels:
    def test_project_detail(self):
        p = ProjectDetail(project_id="p1", project_name="Test", schemas_count=2, constraints_count=3)
        assert p.last_validated is None

    def test_paths_model(self):
        paths = PathsModel(schemas="schemas", constraints="constraints")
        assert paths.patterns is None

    def test_project_config_model(self):
        cfg = ProjectConfigModel(
            project_id="p1",
            project_name="Test",
            paths=PathsModel(schemas="s", constraints="c"),
        )
        assert cfg.paths.schemas == "s"

    def test_standard_response(self):
        r = StandardResponse(message="ok")
        assert r.message == "ok"


class TestSchemaModels:
    def test_schema_save_request(self):
        req = SchemaSaveRequest(
            action="save_schema", schema_name="users", yaml_content="id: users", saved_at="2024-01-01"
        )
        assert req.schema_name == "users"

    def test_schema_save_response(self):
        resp = SchemaSaveResponse(success=True, message="saved", schema_name="users", saved_at="2024-01-01")
        assert resp.success is True

    def test_header_row_changed_request(self):
        req = HeaderRowChangedRequest(action="header_row_changed", node_id="n1")
        assert req.header_row is None

    def test_header_row_changed_response(self):
        resp = HeaderRowChangedResponse(success=True, message="ok")
        assert resp.success is True


class TestWorkspaceModels:
    def test_external_data_source_defaults(self):
        ds = ExternalDataSource(id="ds1", name="data", fileId="f1", type="csv")
        assert ds.status == "ready"
        assert ds.alias is None

    def test_ui_preferences_defaults(self):
        ui = UIPreferences()
        assert ui.startup_loading_enabled is True
        assert "schemas" in ui.expanded_folders

    def test_workspace_config_defaults(self):
        ws = WorkspaceConfig()
        assert ws.version == "1.0"
        assert ws.data_sources == []
        assert ws.ui_preferences.startup_loading_enabled is True


class TestValidationModels:
    def test_regex_validation_request(self):
        req = RegexValidationRequest(regex_pattern=".*", target_column_name="email", source_file_path="data.csv")
        assert req.match_mode == "full"

    def test_regex_validation_result(self):
        result = RegexValidationResult(
            is_valid=True, error_count=0, total_rows=10, match_count=10, validation_time="0.1s"
        )
        assert result.error_rows == []

    def test_regex_validation_response(self):
        resp = RegexValidationResponse(success=True)
        assert resp.error is None

    def test_validation_request(self):
        req = ValidationRequest(validation_type="regex", target_column_name="email", source_file_path="data.csv")
        assert req.allow_unsafe_eval is False

    def test_validation_result(self):
        result = ValidationResult(is_valid=False, error_count=1, total_rows=5, validation_time="0.2s")
        assert result.match_count is None
        assert result.error_rows == []

    def test_validation_response(self):
        resp = ValidationResponse(success=True, validation_type="regex")
        assert resp.error is None

    def test_validation_type_constants(self):
        assert ValidationType.REGEX == "regex"
        assert ValidationType.UNIQUE == "unique"
        assert ValidationType.NOT_NULL == "not_null"
        assert ValidationType.ALLOWED_VALUES == "allowed_values"
        assert ValidationType.CONDITIONAL == "conditional"
        assert ValidationType.SCRIPTED == "scripted"


class TestFullValidationModels:
    def test_coverage_ref(self):
        ref = CoverageRef(id="s1", path="schemas/s1.schema.yaml")
        assert ref.id == "s1"

    def test_coverage_group(self):
        g = CoverageGroup()
        assert g.schemas == []

    def test_validation_coverage(self):
        vc = ValidationCoverage(
            is_complete=True,
            unlisted=CoverageGroup(),
            dangling=CoverageGroup(),
        )
        assert vc.is_complete is True

    def test_validation_settings_override(self):
        s = ValidationSettingsOverride(auto_validate=True, timeout_seconds=30)
        assert s.strict_mode is None

    def test_file_processing_settings_override(self):
        s = FileProcessingSettingsOverride(default_encoding="utf-8")
        assert s.csv_delimiter is None

    def test_script_security_settings_override(self):
        s = ScriptSecuritySettingsOverride(sandbox_mode=True)
        assert s.allow_eval is None

    def test_project_settings_override(self):
        s = ProjectSettingsOverride(validation=ValidationSettingsOverride(auto_validate=True))
        assert s.file_processing is None

    def test_validation_task_target(self):
        t = ValidationTaskTarget(type="full_project")
        assert t.table_id is None

    def test_validation_task_run_options(self):
        o = ValidationTaskRunOptions()
        assert o.data_directory is None

    def test_full_validation_request(self):
        req = FullValidationRequest()
        assert req.target is None
        assert req.options is None

    def test_full_validation_options(self):
        opts = FullValidationOptions()
        assert opts.data_directory is None
        assert opts.override_settings is None

    def test_full_validation_summary(self):
        s = FullValidationSummary(
            files_total=2,
            files_loaded=2,
            tables_loaded=1,
            loading_error_count=0,
            format_error_count=0,
            constraint_error_count=5,
            total_error_count=5,
            duration_ms=100,
        )
        assert s.constraint_error_count == 5

    def test_full_validation_error_item(self):
        e = FullValidationErrorItem(
            stage="constraint",
            error_type="Unique",
            message="duplicate",
            table_id="users",
            row_index=2,
            value="x",
        )
        assert e.column_id is None

    def test_validation_passed_item(self):
        p = ValidationPassedItem(stage="constraint", check_type="NotNull", message="ok", table_id="users")
        assert p.column is None

    def test_validation_statistics(self):
        s = ValidationStatistics(
            total_checks=10,
            passed_count=8,
            failed_count=2,
            pass_rate=80.0,
        )
        assert s.pass_rate == 80.0
        assert s.by_type == {}

    def test_full_validation_response(self):
        summary = FullValidationSummary(
            files_total=1,
            files_loaded=1,
            tables_loaded=1,
            loading_error_count=0,
            format_error_count=0,
            constraint_error_count=0,
            total_error_count=0,
            duration_ms=50,
        )
        resp = FullValidationResponse(success=True, summary=summary)
        assert resp.errors == []
        assert resp.passed_items == []
        assert resp.statistics is None
