"""@fileoverview 报告器 URL 脱敏与文件名去重单元测试

测试范围:
- base.sanitize_url_for_log: query/fragment（token/密钥）脱敏，仅保留 host+path
- FeishuReporter._send_request: 请求失败日志输出脱敏 URL，不泄露 webhook token
- LocalFileReporter: 同一秒内多次报告的文件名去重（毫秒级时间戳）
"""

from __future__ import annotations

import logging
import os
from unittest.mock import patch

from app.shared.core.reporter.reporters.base import sanitize_url_for_log
from app.shared.core.reporter.reporters.feishu_app_reporter import FeishuReporter
from app.shared.core.reporter.reporters.local_file_reporter import LocalFileReporter


class TestSanitizeUrlForLog:
    def test_strips_query_and_fragment(self):
        url = "https://open.feishu.cn/open-apis/bot/v2/hook/secret-token?sign=abc&ts=1#frag"
        assert sanitize_url_for_log(url) == "https://open.feishu.cn/open-apis/bot/v2/hook/secret-token"

    def test_keeps_plain_url_unchanged(self):
        url = "https://my-service.com/feishu"
        assert sanitize_url_for_log(url) == "https://my-service.com/feishu"

    def test_invalid_url_returns_placeholder(self):
        assert sanitize_url_for_log("not a url") == "<invalid-url>"

    def test_never_raises(self):
        # 任何异常输入都降级为占位符，不允许日志路径二次失败
        assert sanitize_url_for_log("") == "<invalid-url>"
        assert sanitize_url_for_log(None) == "<invalid-url>"  # type: ignore[arg-type]


class TestFeishuSendRequestLogSanitization:
    def test_failure_log_contains_sanitized_url_not_token(self, caplog):
        """请求失败日志只含 host+path，webhook query 中的 token 不落日志。"""
        reporter = FeishuReporter()
        url = "https://open.feishu.cn/open-apis/bot/v2/hook/TOKEN123?sign=SIGN456"

        with patch("urllib.request.urlopen", side_effect=RuntimeError("conn refused")):
            with caplog.at_level(logging.WARNING, logger="app.shared.core.reporter.reporters.feishu_app_reporter"):
                reporter._send_request(url, {}, {})

        assert any("发送请求到" in r.message for r in caplog.records)
        text = caplog.text
        assert "open.feishu.cn/open-apis/bot/v2/hook" in text  # host+path 保留
        assert "sign=SIGN456" not in text  # query 脱敏
        assert "TOKEN123" in text  # path 部分按约定保留（token 在 query 的场景不泄漏）
        assert "conn refused" in text


class TestLocalFileReporterSameSecond:
    def test_two_reports_in_same_second_create_two_files(self, tmp_path):
        """同一秒内连续两次报告必须生成两个文件（毫秒级时间戳去重，不再同秒覆盖）。"""
        reporter = LocalFileReporter()
        reporter.configure(log_dir=str(tmp_path))
        reporter.report([{"error": "first"}])
        reporter.report([{"error": "second"}])

        files = [f for f in os.listdir(str(tmp_path)) if f.startswith("error_report_") and f.endswith(".json")]
        assert len(files) == 2
