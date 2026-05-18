"""@fileoverview 邮件报告器模块

功能概述:
- 通过 SMTP 协议发送数据验证错误报告
- 支持 TLS/SSL 加密传输和 HTML 格式邮件
- 配置阶段即验证 SMTP 连接和认证，提前发现问题

架构设计:
- 继承 Reporter 抽象基类，实现 configure() 和 report() 方法
- 双模式连接: 根据端口自动选择 SMTP + STARTTLS (587) 或 SMTP_SSL (465)
- 配置即验证: configure() 阶段建立真实连接测试，确保参数正确
- 资源安全: 使用 with 语句和 try-finally 确保 SMTP 连接正确关闭

输入示例:
    配置参数:
    {
        "smtp_server": "smtp.gmail.com",
        "smtp_port": 587,
        "sender_email": "precis@example.com",
        "sender_password": "app_password",
        "receiver_email": "admin@example.com"
    }

    错误数据:
    [{"error_type": "ForeignKeyViolation", "table": "orders", "value": 99}]

输出示例:
    HTML 邮件内容:
    <html><body>
        <h2>检测到以下数据配置错误：</h2>
        <pre style="...">[...错误JSON...]</pre>
        <p>请尽快检查并修复。</p>
    </body></html>

    控制台输出:
    [EmailReporter] ✓ 邮件服务配置验证成功，发件人: precis@example.com
    [EmailReporter] ✓ 成功发送错误报告邮件至 admin@example.com。
"""

import json
import smtplib
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Any

from .base import Reporter


class EmailReporter(Reporter):
    """
    @classdesc 邮件报告器 - 通过 SMTP 协议发送错误报告

    该报告器将数据验证错误格式化为 HTML 邮件并发送给指定的收件人。
    使用原生 smtplib 实现，避免第三方依赖，提供更好的稳定性和控制力。

    属性说明：
        config: 存储邮件服务器配置信息的字典
               包含 smtp_server, smtp_port, sender_email, sender_password, receiver_email
        is_configured: 标记配置是否通过验证

    功能特点：
        - 配置阶段验证 SMTP 连接和认证
        - 支持 TLS（端口 587）和 SSL（端口 465）两种加密方式
        - HTML 格式邮件，带有错误详情表格
        - 中文编码支持，使用 Header 防止乱码

    使用示例：
        reporter = EmailReporter()
        if reporter.configure(
            smtp_server='smtp.example.com',
            smtp_port=587,
            sender_email='precis@example.com',
            sender_password='secret',
            receiver_email='admin@example.com'
        ):
            reporter.report(errors)
    """

    def __init__(self):
        """
        初始化邮件报告器

        调用父类构造函数设置报告器名称为 'EmailReporter'。
        初始化配置字典和配置状态标志。
        """
        super().__init__("EmailReporter")
        self.config = {}
        self.is_configured = False

    def configure(
        self,
        smtp_server: str,
        smtp_port: int,
        sender_email: str,
        sender_password: str,
        receiver_email: str,
        **config: Any,
    ) -> bool:
        """
        @methoddesc 配置邮件服务器参数并在配置阶段验证连接

        该方法会验证所有必需的 SMTP 参数，并尝试建立连接进行认证验证。
        只有配置验证通过后，才能调用 report() 方法发送邮件。

        :param smtp_server: SMTP 服务器地址（如 'smtp.gmail.com'）
        :param smtp_port: SMTP 服务器端口
                         通常 587 使用 TLS，465 使用 SSL
        :param sender_email: 发件人邮箱地址
        :param sender_password: 发件人邮箱密码或应用专用密码
        :param receiver_email: 收件人邮箱地址
        :param config: 额外的可选配置参数（当前未使用，保留扩展性）
        :return: 配置验证是否成功。成功返回 True，失败返回 False

        验证流程：
            1. 检查所有必需参数是否提供
            2. 将配置参数保存到实例变量
            3. 尝试建立 SMTP 连接并登录
            4. 如果连接成功，设置 is_configured 为 True
        """
        # 参数完整性检查：确保所有必需的配置都已提供
        if not all([smtp_server, smtp_port, sender_email, sender_password, receiver_email]):
            print(f"[{self.name}] 邮件配置信息不完整, 无法启用。")
            return False

        # 将配置保存到实例变量中，供后续 report() 方法使用
        self.config = {
            "smtp_server": smtp_server,
            "smtp_port": smtp_port,
            "sender_email": sender_email,
            "sender_password": sender_password,
            "receiver_email": receiver_email,
        }

        # 尝试连接和登录以验证配置的正确性
        # 使用 with 语句确保连接被正确关闭，即使发生异常
        try:
            # 建立 SMTP 连接，设置 10 秒超时防止阻塞
            with smtplib.SMTP(smtp_server, smtp_port, timeout=10) as smtp:
                # 升级到 TLS 加密连接，这是现代 SMTP 服务的安全要求
                # TLS 适用于端口 587，是比 SSL 更常用的选择
                smtp.starttls()
                # 使用提供的凭证登录
                smtp.login(sender_email, sender_password)

            # 配置验证成功，打印成功信息（不包含敏感密码）
            print(f"[{self.name}] ✓ 邮件服务配置验证成功，发件人: {sender_email}")
            self.is_configured = True
            return True

        except Exception as e:
            # 配置验证失败，打印错误信息用于调试
            print(f"[{self.name}] !! 错误: 邮件服务配置验证失败: {e}")
            self.is_configured = False
            return False

    def report(self, errors: list[dict]):
        """
        @methoddesc 将错误报告发送到指定的邮件地址

        在发送邮件前会检查配置状态，确保邮件服务已正确配置。
        邮件内容为 HTML 格式，包含错误数量和详细的 JSON 格式错误列表。

        :param errors: 错误信息的字典列表，每个字典包含错误详情
                      典型字段：row_index, column, value, error_type, error_message

        邮件内容格式：
            - 标题：【数据验证警告】发现 N 个错误!
            - 正文：包含错误数量的说明和 JSON 格式的错误详情

        发送流程：
            1. 检查是否已配置（is_configured 标志）
            2. 构建 HTML 邮件内容
            3. 设置邮件头部（Subject, From, To）
            4. 根据端口选择 SMTP 或 SMTP_SSL 连接
            5. 登录并发送邮件
            6. 在 finally 块中确保连接关闭
        """
        # 前置检查：确保邮件服务已配置
        if not self.is_configured:
            print(f"[{self.name}] !! 错误: 邮件服务未配置或配置失败，无法发送邮件。")
            return

        # 构建邮件标题，包含错误数量
        subject = f"【数据验证警告】发现 {len(errors)} 个错误!"

        # 构建 HTML 邮件正文，使用 JSON 格式化错误列表
        # 使用 pre 标签保持 JSON 的格式和缩进
        html_body = f"""
        <html><body>
            <h2>检测到以下数据配置错误：</h2>
            <pre style=\"background-color: #f0f0f0; padding: 10px; border-radius: 5px; white-space: pre-wrap; word-wrap: break-word;\">{json.dumps(errors, indent=2, ensure_ascii=False)}</pre>
            <p>请尽快检查并修复。</p>
        </body></html>
        """

        # 创建 MIMEText 邮件对象，指定 HTML 格式和 UTF-8 编码
        msg = MIMEText(html_body, "html", "utf-8")

        # 使用 Header 对象编码邮件标题，确保中文正确显示
        msg["Subject"] = Header(subject, "utf-8")

        # 使用 formataddr 正确格式化发件人和收件人地址
        # formataddr((友好名称, 邮件地址)) 格式
        # 使用 Header 编码友好名称以支持中文
        msg["From"] = formataddr((Header("数据验证服务", "utf-8").encode(), self.config["sender_email"]))
        msg["To"] = formataddr((Header("项目负责人", "utf-8").encode(), self.config["receiver_email"]))

        # 建立 SMTP 连接并发送邮件
        smtp = None
        try:
            # 根据端口号判断使用哪种连接方式：
            # - 端口 465 通常使用 SSL 加密的 SMTP_SSL
            # - 端口 587 通常使用 STARTTLS 升级到 TLS
            if self.config["smtp_port"] == 465:
                smtp = smtplib.SMTP_SSL(self.config["smtp_server"], self.config["smtp_port"], timeout=10)
            else:
                # 端口不是 465，使用普通 SMTP 然后升级到 TLS
                smtp = smtplib.SMTP(self.config["smtp_server"], self.config["smtp_port"], timeout=10)
                smtp.starttls()

            # 使用配置中的凭证登录 SMTP 服务器
            smtp.login(self.config["sender_email"], self.config["sender_password"])

            # 发送邮件，sender 和 receiver 都可以是列表
            smtp.sendmail(self.config["sender_email"], [self.config["receiver_email"]], msg.as_string())

            # 发送成功，打印确认信息
            print(f"[{self.name}] ✓ 成功发送错误报告邮件至 {self.config['receiver_email']}。")

        except Exception as e:
            # 发送失败，打印错误信息（不包含敏感内容）
            print(f"[{self.name}] !! 错误: 发送邮件失败: {e}")

        finally:
            # 确保 SMTP 连接被正确关闭，释放资源
            # 使用 try-finally 确保即使发生异常也会关闭连接
            if smtp:
                smtp.quit()
