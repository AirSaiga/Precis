"""测试报告服务模块"""

from __future__ import annotations

import json

from app.shared.core.reporter.reporter import ReportService
from app.shared.core.reporter.reporters.base import Reporter
from app.shared.core.reporter.reporters.local_file_reporter import LocalFileReporter


class TestReportService:
    def test_init_without_config(self, tmp_path, capsys):
        service = ReportService(base_dir=str(tmp_path))
        assert service.base_dir == str(tmp_path)
        assert len(service._active_reporters) == 0
        captured = capsys.readouterr()
        assert "报告服务已初始化" in captured.out

    def test_init_with_config(self, tmp_path, capsys):
        config = tmp_path / "reporting_config.yaml"
        config.write_text("""
reporters:
  local_file:
    enabled: true
  email:
    enabled: false
""")
        service = ReportService(base_dir=str(tmp_path))
        assert len(service._active_reporters) >= 0
        captured = capsys.readouterr()
        assert "报告服务配置完成" in captured.out

    def test_init_bad_yaml(self, tmp_path, capsys):
        config = tmp_path / "reporting_config.yaml"
        config.write_text("not: valid: yaml: [")
        service = ReportService(base_dir=str(tmp_path))
        assert len(service._active_reporters) == 0
        captured = capsys.readouterr()
        assert "错误" in captured.out

    def test_report_empty_errors(self, capsys):
        service = ReportService(base_dir="/tmp")
        service.report([])
        captured = capsys.readouterr()
        assert "无需报告" in captured.out

    def test_report_no_reporters_fallback(self, capsys):
        service = ReportService(base_dir="/tmp")
        errors = [{"msg": "error1"}]
        service.report(errors)
        captured = capsys.readouterr()
        assert "无激活的报告者" in captured.out
        assert "error1" in captured.out

    def test_report_with_active_reporter(self, tmp_path, capsys):
        config = tmp_path / "reporting_config.yaml"
        config.write_text("""
reporters:
  local_file:
    enabled: true
""")
        service = ReportService(base_dir=str(tmp_path))
        errors = [{"msg": "error1"}]
        service.report(errors)
        captured = capsys.readouterr()
        assert "开始报告" in captured.out
        assert "报告流程结束" in captured.out

    def test_unknown_reporter_warns(self, tmp_path, capsys):
        config = tmp_path / "reporting_config.yaml"
        config.write_text("""
reporters:
  unknown_reporter:
    enabled: true
""")
        _ = ReportService(base_dir=str(tmp_path))
        captured = capsys.readouterr()
        assert "未找到" in captured.out

    def test_disabled_reporter_skipped(self, tmp_path, capsys):
        config = tmp_path / "reporting_config.yaml"
        config.write_text("""
reporters:
  local_file:
    enabled: false
""")
        _ = ReportService(base_dir=str(tmp_path))
        captured = capsys.readouterr()
        assert "未启用" in captured.out


class TestLocalFileReporter:
    def test_configure_creates_directory(self, tmp_path):
        reporter = LocalFileReporter()
        log_dir = tmp_path / "logs"
        result = reporter.configure(log_dir=str(log_dir))
        assert result is True
        assert log_dir.exists()

    def test_report_writes_file(self, tmp_path):
        reporter = LocalFileReporter()
        log_dir = tmp_path / "logs"
        reporter.configure(log_dir=str(log_dir))
        errors = [{"type": "TestError", "msg": "test"}]
        reporter.report(errors)
        files = list(log_dir.glob("error_report_*.json"))
        assert len(files) == 1
        data = json.loads(files[0].read_text(encoding="utf-8"))
        assert data == errors

    def test_report_without_config(self, capsys):
        reporter = LocalFileReporter()
        reporter.report([{"msg": "test"}])
        captured = capsys.readouterr()
        assert "未配置" in captured.out

    def test_report_empty_errors(self, tmp_path):
        reporter = LocalFileReporter()
        log_dir = tmp_path / "logs"
        reporter.configure(log_dir=str(log_dir))
        reporter.report([])
        files = list(log_dir.glob("error_report_*.json"))
        assert len(files) == 1
        data = json.loads(files[0].read_text(encoding="utf-8"))
        assert data == []


class TestReporterBase:
    def test_abstract_methods(self):
        class DummyReporter(Reporter):
            def configure(self, **config):
                return True

            def report(self, errors):
                pass

        reporter = DummyReporter(name="dummy")
        assert reporter.name == "dummy"
        assert reporter.configure() is True
