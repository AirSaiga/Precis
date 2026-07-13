"""
@fileoverview 报告服务行为测试

覆盖 ReportService 初始化、配置加载与 report 流程。
"""

from __future__ import annotations

import logging

from app.shared.core.reporter.reporter import ReportService


class TestReportService:
    """报告服务行为"""

    def test_no_config_activates_zero_reporters(self, tmp_path, caplog):
        with caplog.at_level(logging.WARNING, logger="app.shared.core.reporter.reporter"):
            service = ReportService(base_dir=str(tmp_path), config_filename="missing.yaml")
        assert len(service._active_reporters) == 0
        assert "未找到" in caplog.text

    def test_local_file_reporter_activated(self, tmp_path):
        config_file = tmp_path / "reporting_config.yaml"
        config_file.write_text(
            "version: '1.0'\nreporters:\n  local_file:\n    enabled: true\n",
            encoding="utf-8",
        )
        service = ReportService(base_dir=str(tmp_path))
        assert len(service._active_reporters) == 1
        assert (tmp_path / "logs").is_dir()

    def test_report_empty_errors_returns_early(self, tmp_path, caplog):
        config_file = tmp_path / "reporting_config.yaml"
        config_file.write_text(
            "version: '1.0'\nreporters:\n  local_file:\n    enabled: true\n",
            encoding="utf-8",
        )
        service = ReportService(base_dir=str(tmp_path))
        with caplog.at_level(logging.INFO, logger="app.shared.core.reporter.reporter"):
            service.report([])
        assert "无需报告" in caplog.text

    def test_report_with_active_reporter(self, tmp_path, caplog):
        config_file = tmp_path / "reporting_config.yaml"
        config_file.write_text(
            "version: '1.0'\nreporters:\n  local_file:\n    enabled: true\n",
            encoding="utf-8",
        )
        service = ReportService(base_dir=str(tmp_path))
        with caplog.at_level(logging.INFO, logger="app.shared.core.reporter.reporter"):
            service.report([{"error_type": "TestError", "message": "test"}])
        assert "开始报告" in caplog.text
