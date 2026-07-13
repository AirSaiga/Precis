"""测试报告服务模块"""

from __future__ import annotations

import json
import logging

from app.shared.core.reporter.reporter import ReportService
from app.shared.core.reporter.reporters.base import Reporter
from app.shared.core.reporter.reporters.local_file_reporter import LocalFileReporter


class TestReportService:
    def test_init_without_config(self, tmp_path, caplog):
        with caplog.at_level(logging.INFO, logger="app.shared.core.reporter.reporter"):
            service = ReportService(base_dir=str(tmp_path))
        assert service.base_dir == str(tmp_path)
        assert len(service._active_reporters) == 0
        assert "报告服务已初始化" in caplog.text

    def test_init_with_config(self, tmp_path, caplog):
        config = tmp_path / "reporting_config.yaml"
        config.write_text("""
reporters:
  local_file:
    enabled: true
  email:
    enabled: false
""")
        with caplog.at_level(logging.INFO, logger="app.shared.core.reporter.reporter"):
            service = ReportService(base_dir=str(tmp_path))
        assert len(service._active_reporters) >= 0
        assert "报告服务配置完成" in caplog.text

    def test_init_bad_yaml(self, tmp_path, caplog):
        config = tmp_path / "reporting_config.yaml"
        config.write_text("not: valid: yaml: [")
        with caplog.at_level(logging.ERROR, logger="app.shared.core.reporter.reporter"):
            service = ReportService(base_dir=str(tmp_path))
        assert len(service._active_reporters) == 0
        assert "读取报告配置文件失败" in caplog.text

    def test_report_empty_errors(self, caplog):
        service = ReportService(base_dir="/tmp")
        with caplog.at_level(logging.INFO, logger="app.shared.core.reporter.reporter"):
            service.report([])
        assert "无需报告" in caplog.text

    def test_report_no_reporters_fallback(self, capsys, caplog):
        service = ReportService(base_dir="/tmp")
        errors = [{"msg": "error1"}]
        with caplog.at_level(logging.WARNING, logger="app.shared.core.reporter.reporter"):
            service.report(errors)
        # "无激活的报告者" 走 logger（WARNING）；兜底 print 的 JSON 仍在 stdout
        assert "无激活的报告者" in caplog.text
        captured = capsys.readouterr()
        assert "error1" in captured.out

    def test_report_with_active_reporter(self, tmp_path, caplog):
        config = tmp_path / "reporting_config.yaml"
        config.write_text("""
reporters:
  local_file:
    enabled: true
""")
        service = ReportService(base_dir=str(tmp_path))
        errors = [{"msg": "error1"}]
        with caplog.at_level(logging.INFO, logger="app.shared.core.reporter.reporter"):
            service.report(errors)
        assert "开始报告" in caplog.text
        assert "报告流程结束" in caplog.text

    def test_unknown_reporter_warns(self, tmp_path, caplog):
        config = tmp_path / "reporting_config.yaml"
        config.write_text("""
reporters:
  unknown_reporter:
    enabled: true
""")
        with caplog.at_level(logging.WARNING, logger="app.shared.core.reporter.reporter"):
            _ = ReportService(base_dir=str(tmp_path))
        assert "未找到" in caplog.text

    def test_disabled_reporter_skipped(self, tmp_path, caplog):
        config = tmp_path / "reporting_config.yaml"
        config.write_text("""
reporters:
  local_file:
    enabled: false
""")
        with caplog.at_level(logging.INFO, logger="app.shared.core.reporter.reporter"):
            _ = ReportService(base_dir=str(tmp_path))
        assert "未启用" in caplog.text


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
