"""@fileoverview 邮件报告器单元测试

测试范围:
- configure(): 端口 465 走 SMTP_SSL（与 report() 对齐），其余端口走 SMTP + STARTTLS
- report(): 错误数据进 HTML <pre> 前必须 html.escape（防邮件 HTML 注入）
- report(): finally 中 smtp.quit() 的次要异常不得吞掉发送阶段的原始异常
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from app.shared.core.reporter.reporters.email_reporter import EmailReporter


def _valid_config(port: int = 587) -> dict:
    return {
        "smtp_server": "smtp.example.com",
        "smtp_port": port,
        "sender_email": "precis@example.com",
        "sender_password": "secret",
        "receiver_email": "admin@example.com",
    }


def _make_fake_smtp_class(instance: Any) -> type:
    """生成记录调用到 instance（MagicMock）的 FakeSMTP 类。

    用真类而非 MagicMock 替换 smtplib.SMTP，保证 report() 内
    isinstance(smtp, smtplib.SMTP) 的类型检查仍然成立。
    """

    class FakeSMTP:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def starttls(self) -> None:
            instance.starttls()

        def login(self, user: str, pw: str) -> None:
            instance.login(user, pw)

        def sendmail(self, frm: str, to: list, msg: str) -> None:
            instance.sendmail(frm, to, msg)

        def quit(self) -> None:
            instance.quit()

    return FakeSMTP


class TestConfigureConnectionMode:
    def test_configure_port_465_uses_smtp_ssl(self):
        """端口 465 必须用 SMTP_SSL——此前 configure() 走 SMTP+starttls，对隐式 SSL 端口必失败。"""
        reporter = EmailReporter()
        with patch("smtplib.SMTP_SSL") as mock_ssl, patch("smtplib.SMTP") as mock_plain:
            mock_ssl.return_value.__enter__ = MagicMock(return_value=MagicMock())
            mock_ssl.return_value.__exit__ = MagicMock(return_value=False)
            ok = reporter.configure(**_valid_config(port=465))

        assert ok is True
        assert reporter.is_configured is True
        mock_ssl.assert_called_once()
        mock_plain.assert_not_called()

    def test_configure_port_587_uses_starttls(self):
        """端口 587 仍走 SMTP + STARTTLS（原有行为保持）。"""
        reporter = EmailReporter()
        smtp_instance = MagicMock()
        with patch("smtplib.SMTP", return_value=smtp_instance) as mock_plain, patch("smtplib.SMTP_SSL") as mock_ssl:
            smtp_instance.__enter__ = MagicMock(return_value=smtp_instance)
            smtp_instance.__exit__ = MagicMock(return_value=False)
            ok = reporter.configure(**_valid_config(port=587))

        assert ok is True
        mock_plain.assert_called_once()
        smtp_instance.starttls.assert_called_once()
        mock_ssl.assert_not_called()


class TestReport:
    def _configure(self, reporter: EmailReporter) -> None:
        reporter.config = {
            "smtp_server": "smtp.example.com",
            "smtp_port": 587,
            "sender_email": "precis@example.com",
            "sender_password": "secret",
            "receiver_email": "admin@example.com",
        }
        reporter.is_configured = True

    def test_error_payload_html_escaped(self):
        """错误值含 <script> 时进 <pre> 前必须被转义，防止邮件 HTML 注入。"""
        import base64

        reporter = EmailReporter()
        self._configure(reporter)
        smtp_instance = MagicMock()

        with patch("smtplib.SMTP", new=_make_fake_smtp_class(smtp_instance)):
            reporter.report([{"row_index": 0, "value": "<script>alert(1)</script>"}])

        sent_msg = smtp_instance.sendmail.call_args.args[2]
        # MIMEText 以 base64 传输 UTF-8 正文，先解出 HTML 再断言
        payload = sent_msg.split("\n\n", 1)[1].replace("\n", "")
        html_body = base64.b64decode(payload).decode("utf-8")
        assert "<script>alert(1)</script>" not in html_body
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html_body

    def test_quit_failure_does_not_mask_send_error(self):
        """发送失败且 quit() 也抛异常时，异常不得向外传播（quit 的次要异常被吞掉）。"""
        reporter = EmailReporter()
        self._configure(reporter)
        smtp_instance = MagicMock()
        smtp_instance.sendmail.side_effect = RuntimeError("smtp send failed")
        smtp_instance.quit.side_effect = RuntimeError("quit failed")

        with patch("smtplib.SMTP", new=_make_fake_smtp_class(smtp_instance)):
            # 不应抛出 RuntimeError("quit failed") 或任何异常
            reporter.report([{"value": 1}])

        smtp_instance.quit.assert_called_once()
