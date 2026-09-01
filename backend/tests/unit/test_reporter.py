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


class TestTruncateToByteLimit:
    """回归: 消息截断必须按 UTF-8 字节而非字符，避免中文截断后仍超限被平台拒收。"""

    def test_short_text_returned_unchanged(self):
        from app.shared.core.reporter.reporters.base import truncate_to_byte_limit

        text = "只有一小段"
        assert truncate_to_byte_limit(text, 100) == text

    def test_truncated_total_bytes_within_limit(self):
        from app.shared.core.reporter.reporters.base import truncate_to_byte_limit

        # 中文每个字符 UTF-8 占 3 字节：按字符截断一半后字节数仍会超限
        text = "错" * 20000  # 60000 字节
        result = truncate_to_byte_limit(text, 3000)
        assert len(result.encode("utf-8")) <= 3000, "截断结果（含省略标记）必须不超过字节上限"
        assert result.endswith("... (内容过长，已截断)")

    def test_truncation_does_not_split_multibyte_character(self):
        from app.shared.core.reporter.reporters.base import truncate_to_byte_limit

        text = "数" * 1000  # 3000 字节
        result = truncate_to_byte_limit(text, 100)
        # 结果必须是合法可解码文本（无乱码/替换符），即没有截在多字节字符中间
        assert "\ufffd" not in result
        assert result.encode("utf-8").decode("utf-8") == result

    def test_truncation_keeps_content_prefix(self):
        from app.shared.core.reporter.reporters.base import truncate_to_byte_limit

        text = "abcdef" * 1000
        result = truncate_to_byte_limit(text, 100)
        assert result.startswith("abcdef")

    def test_feishu_card_error_details_within_28kb(self):
        """飞书卡片：中文错误详情截断后 UTF-8 字节数不得超过 28000。"""
        from app.shared.core.reporter.reporters.feishu_app_reporter import FeishuReporter

        reporter = FeishuReporter()
        reporter.config = {"webhook_url": "https://example.com/hook"}
        reporter.is_configured = True
        reporter.mode = "webhook"

        errors = [{"error_type": "NotNullViolation", "value": "中文" * 5000, "row_index": i} for i in range(50)]
        card = reporter._create_message_card(errors)
        content = card["elements"][0]["text"]["content"]
        assert len(content.encode("utf-8")) <= 28000

    def test_dingtalk_message_error_details_within_4kb(self):
        """钉钉：中文错误详情截断后 UTF-8 字节数不得超过 4000。

        过去按字节检查（>4000 才截）、按字符截 2000 字符：2000 个中文 = 6000 字节，
        截断后反而更大，必然被平台拒收。
        """
        from unittest.mock import MagicMock

        from app.shared.core.reporter.reporters.dingtalk_app_reporter import DingTalkAppReporter

        reporter = DingTalkAppReporter()
        assert reporter.configure(app_key="k", app_secret="s", agent_id=1, userid_list="u1") is True
        reporter._get_access_token = MagicMock(return_value="token")
        captured: dict = {}

        def fake_send(url, payload):
            captured["text"] = payload["msg"]["markdown"]["text"]

        reporter._send_request = fake_send
        errors = [{"error_type": "NotNullViolation", "value": "中文" * 3000, "row_index": 1}]
        reporter.report(errors)

        text = captured["text"]
        assert len(text.encode("utf-8")) <= 4000
        assert "... (内容过长，已截断)" in text

    def test_wecom_message_error_details_within_2kb(self):
        """企业微信：中文错误详情截断后 UTF-8 字节数不得超过 2048。"""
        from unittest.mock import MagicMock

        from app.shared.core.reporter.reporters.wecom_app_reporter import WeComAppReporter

        reporter = WeComAppReporter()
        assert reporter.configure(corp_id="c", corp_secret="s", agent_id=1, touser="@all") is True
        reporter._get_access_token = MagicMock(return_value="token")
        captured: dict = {}

        def fake_send(url, payload):
            captured["content"] = payload["markdown"]["content"]

        reporter._send_request = fake_send
        errors = [{"error_type": "NotNullViolation", "value": "中文" * 2000, "row_index": 1}]
        reporter.report(errors)

        content = captured["content"]
        assert len(content.encode("utf-8")) <= 2048
        assert "... (内容过长，已截断)" in content
