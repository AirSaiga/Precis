"""
@fileoverview 报告服务行为测试

覆盖 ReportService 初始化、配置加载与 report 流程。
"""

from __future__ import annotations

from app.shared.core.reporter.reporter import ReportService


class TestReportService:
    """报告服务行为"""

    def test_no_config_activates_zero_reporters(self, tmp_path, capsys):
        service = ReportService(base_dir=str(tmp_path), config_filename="missing.yaml")
        assert len(service._active_reporters) == 0
        captured = capsys.readouterr()
        assert "未找到" in captured.out

    def test_local_file_reporter_activated(self, tmp_path):
        config_file = tmp_path / "reporting_config.yaml"
        config_file.write_text(
            "version: '1.0'\nreporters:\n  local_file:\n    enabled: true\n",
            encoding="utf-8",
        )
        service = ReportService(base_dir=str(tmp_path))
        assert len(service._active_reporters) == 1
        assert (tmp_path / "logs").is_dir()

    def test_report_empty_errors_returns_early(self, tmp_path, capsys):
        config_file = tmp_path / "reporting_config.yaml"
        config_file.write_text(
            "version: '1.0'\nreporters:\n  local_file:\n    enabled: true\n",
            encoding="utf-8",
        )
        service = ReportService(base_dir=str(tmp_path))
        service.report([])
        captured = capsys.readouterr()
        assert "无需报告" in captured.out

    def test_report_with_active_reporter(self, tmp_path, capsys):
        config_file = tmp_path / "reporting_config.yaml"
        config_file.write_text(
            "version: '1.0'\nreporters:\n  local_file:\n    enabled: true\n",
            encoding="utf-8",
        )
        service = ReportService(base_dir=str(tmp_path))
        service.report([{"error_type": "TestError", "message": "test"}])
        captured = capsys.readouterr()
        assert "开始报告" in captured.out
