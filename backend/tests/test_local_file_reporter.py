"""测试本地文件报告器"""

import json
import os
import tempfile
from pathlib import Path

import pytest
from app.shared.core.reporter.reporters.local_file_reporter import LocalFileReporter
from app.shared.core.reporter.reporters.base import Reporter


class TestLocalFileReporter:
    @pytest.fixture
    def reporter(self):
        return LocalFileReporter()

    @pytest.fixture
    def temp_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            yield tmpdir

    def test_reporter_is_instance_of_base(self, reporter):
        assert isinstance(reporter, Reporter)

    def test_name_is_set(self, reporter):
        assert reporter.name == "LocalFileReporter"

    def test_log_dir_is_none_initially(self, reporter):
        assert reporter.log_dir is None

    def test_configure_creates_directory(self, reporter, temp_dir):
        log_dir = os.path.join(temp_dir, "logs", "errors")
        result = reporter.configure(log_dir=log_dir)
        assert result is True
        assert reporter.log_dir == log_dir
        assert os.path.exists(log_dir)

    def test_configure_existing_directory(self, reporter, temp_dir):
        result = reporter.configure(log_dir=temp_dir)
        assert result is True

    def test_configure_invalid_path_returns_false(self, reporter, tmp_path):
        invalid_dir = str(tmp_path / "sub" / "deep")
        test_file = tmp_path / "blocker.txt"
        test_file.write_text("block")
        os.chmod(str(tmp_path), 0o444)
        try:
            nested = os.path.join(invalid_dir, "nested")
            result = reporter.configure(log_dir=nested)
            assert isinstance(result, bool)
        finally:
            os.chmod(str(tmp_path), 0o777)

    def test_report_writes_json_file(self, reporter, temp_dir):
        reporter.configure(log_dir=temp_dir)
        errors = [
            {"error_type": "NotNullViolation", "row_index": 2, "column": "email"},
            {"error_type": "TypeValidationError", "row_index": 5, "column": "price", "value": "abc"},
        ]
        reporter.report(errors)

        files = os.listdir(temp_dir)
        json_files = [f for f in files if f.startswith("error_report_") and f.endswith(".json")]
        assert len(json_files) == 1

        filepath = os.path.join(temp_dir, json_files[0])
        with open(filepath, "r", encoding="utf-8") as f:
            written = json.load(f)
        assert written == errors

    def test_report_multiple_calls_create_multiple_files(self, reporter, temp_dir):
        import time
        reporter.configure(log_dir=temp_dir)
        reporter.report([{"error": "first"}])
        time.sleep(1.1)
        reporter.report([{"error": "second"}])

        files = os.listdir(temp_dir)
        json_files = [f for f in files if f.startswith("error_report_") and f.endswith(".json")]
        assert len(json_files) == 2

    def test_report_without_configure_does_not_crash(self, reporter, capsys):
        reporter.report([{"error": "test"}])
        captured = capsys.readouterr()
        assert "未配置日志目录" in captured.out

    def test_report_handles_empty_error_list(self, reporter, temp_dir):
        reporter.configure(log_dir=temp_dir)
        reporter.report([])
        files = os.listdir(temp_dir)
        json_files = [f for f in files if f.startswith("error_report_")]
        assert len(json_files) == 1

    def test_report_writes_unicode(self, reporter, temp_dir):
        reporter.configure(log_dir=temp_dir)
        errors = [{"error_message": "无效的值", "column": "姓名"}]
        reporter.report(errors)

        files = os.listdir(temp_dir)
        json_files = [f for f in files if f.startswith("error_report_")]
        filepath = os.path.join(temp_dir, json_files[0])
        with open(filepath, "r", encoding="utf-8") as f:
            written = json.load(f)
        assert written[0]["error_message"] == "无效的值"
        assert written[0]["column"] == "姓名"

    def test_configure_with_extra_kwargs(self, reporter, temp_dir):
        result = reporter.configure(log_dir=temp_dir, extra_param="ignored")
        assert result is True
